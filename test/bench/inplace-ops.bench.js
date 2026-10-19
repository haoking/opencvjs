"use strict";

// Performance regression gate for the in-place writes.
//
// What this gate guards against
// -----------------------------
// replaceMatOnRect / rectAdd / rectSubtract / replaceMatOnCol / addOnCol write pixel by
// pixel. They prove the index range valid once on entry with the guards, and their loops
// address the wasm heap directly (typed-access's pixels()) **without a single Embind
// call**.
//
// The easiest regression is "call an accessor per pixel": native *Ptr(i, j) (as 3.0.0
// did) or the shorter PTR(i, j). The code is shorter and correct, but every pixel crosses
// the language boundary and creates a new TypedArray (PTR also reads the rows / cols
// Embind getters) — two orders of magnitude slower. Every run of this file measures both
// forms as "regression references" and prints the factors. **Do not copy factors into
// comments elsewhere**: the sources once quoted 38% / 82% / 105% at the same time (three
// comparisons measured differently), a factor of two apart; quote this gate's output.
//
// Why region-ops.bench.js does not cover this
// -------------------------------------------
// That gate measures roiClone(), which is "native roi + clone" inside and **does not loop
// per pixel at all**. Turning the loops above back into per-pixel accessor calls keeps it
// green — before this file existed, such a regression could have slipped into the main
// branch unnoticed, the kind of lying green light this project keeps removing.
//
// The shape of the gate (one counter-intuitive point)
// ---------------------------------------------------
// The intuitive version is "control = the regressed form, threshold 1.5×". **That does not
// work**; the direction is wrong: the implementation under test is far faster than the
// regressed form, so the ratio is far below 1, and if someone did put the regressed loop
// back, the ratio would only rise to about 1.0, still far from 1.5, and the gate would
// print "pass". So the baseline is **a hand-written reference that addresses the heap
// directly** — what the implementation under test should look like (just as
// region-ops.bench.js uses the primitives the implementation wraps) — and the threshold is
// reference × 1.5. This shape fires on "the loop got slower" itself, not on one particular
// rewrite. The regression references are still measured every round, to check that this
// gate **can still tell the difference**; see MIN_DISCRIMINATION.
//
// Counts, sizes and what is compared
// ----------------------------------
// The fast and slow implementations are two orders of magnitude apart: with one count the
// fast ones run for a few milliseconds and cannot be measured, or the slow ones take
// seconds per round. So each kind has its own count, and the comparison is **per call**.
//
// The sizes are large on purpose (256×256 written into 512×512, columns of 512). Each call
// has a fixed cost independent of the pixel count: entry validation reads Embind getters
// such as rows / cols, and addressing reads data / step. On 32×32 the loop itself takes
// about 1 µs, the fixed cost is 30–40% of that, and the ratio hovered at the 1.5 threshold
// (1.46–1.48x measured), so the gate failed at random. This gate guards against
// **per-pixel** regressions; at a large size the fixed cost is negligible and a regression
// still shows at a glance.
//
// Measured like region-ops.bench.js: the start order rotates every round, round 1 is
// discarded (whoever runs first pays the one-time JIT tiering and Embind call bridge
// warm-up, an artifact of measurement order), and the minimum from round 2 on is taken.
const { getCv } = require("../helpers");

const SIZE = 512; // a 512×512 CV_32FC1 source
const RECT = { x: 1, y: 1, width: 256, height: 256 };
const COL = 3;
const ROUNDS = 4; // round 1 is warm-up and discarded; the minimum of rounds 2..4 is taken

// How much slower than the reference the implementation under test may be. The extra time
// should only be the fixed cost of entry validation and taking the heap view, with 50%
// left for measurement noise (region-ops.bench.js uses 1.5 for the same reason).
const LIMIT_FACTOR = 1.5;

// Each regression reference must be at least this much slower than the reference for the
// gate to mean anything: if the regressed form were only 20% slower, putting it back would
// pass a 1.5× gate. Falling below this must fail loudly instead of staying green — it
// means Embind calls got cheaper (recalibrate the gate) or the implementation under test
// is quietly doing the equivalent.
const MIN_DISCRIMINATION = 1.5;

// With ROUNDS < 2, rounds.slice(1) is empty, Math.min() returns Infinity, the threshold
// becomes Infinity, and `actual > LIMIT` is always false — the gate would always print
// "✅ performance OK" while checking nothing. ROUNDS is a constant with no external input,
// so this cannot happen today, but it is exactly the "green gate that checks nothing"
// pattern, so it is closed off. (console.error + process.exit rather than throw: a gate
// needs a clear exit code, not a stack trace; see the same comment in
// region-ops.bench.js.)
if (ROUNDS < 2) {
  console.error(
    `❌ ROUNDS must be >= 2 (it is ${ROUNDS}): round 1 is warm-up and discarded, and ` +
      `with fewer than 2 rounds Math.min(...[]) === Infinity, so the threshold is void and the gate always passes.`,
  );
  process.exit(1);
}

/** Runs fn n times and returns the mean time per call in microseconds. */
function perCallMicros(n, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) fn();
  return Number(process.hrtime.bigint() - start) / 1e3 / n;
}

async function main() {
  const cv = await getCv();

  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  const mat = cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
  const src = cv.matFromArray(
    RECT.height,
    RECT.width,
    cv.CV_32FC1,
    new Array(RECT.height * RECT.width).fill(1),
  );
  const rect = new cv.Rect(RECT.x, RECT.y, RECT.width, RECT.height);
  const colArr = new Array(SIZE).fill(2);

  /**
   * Addressing for the reference: taken again on every call (as the implementation under
   * test does), CV_32F only. The heap view is taken last, for the reason given at
   * typed-access.js's pixels().
   */
  function layout(m) {
    const base = m.data.byteOffset / 4;
    const rowStep = m.step[0] / 4;
    const pixelStep = m.elemSize() / 4;
    return { heap: cv.HEAPF32, base, rowStep, pixelStep };
  }

  // Four implementations per case:
  //   reference — addresses the heap directly (what the implementation should look like); the baseline
  //   actual    — the method actually published in dist/
  //   nativePtr — regression reference: native floatPtr() per pixel in the loop (as in 3.0.0)
  //   viaPTR    — regression reference: PTR() per pixel in the loop
  // fast / slow are the call counts for the two kinds.
  // Neither the reference nor the regression references take an "(old, new) => value"
  // callback: the three cases share one function literal, the callback's call site would
  // turn polymorphic and V8 would stop inlining, making the reference itself slower and
  // the gate looser. The implementation under test is split into fixed-shape kernels for
  // the same reason (see mat-region.js).
  // sign: 0 = copy, 1 = add, -1 = subtract.
  const CASES = [];
  for (const [name, sign] of [
    ["replaceMatOnRect", 0],
    ["rectAdd", 1],
    ["rectSubtract", -1],
  ]) {
    CASES.push({
      name: `${name} ${RECT.width}×${RECT.height}`,
      fast: 1000,
      slow: 10,
      reference() {
        const d = layout(mat);
        const s = layout(src);
        const { x, y, width: w, height: h } = rect;
        for (let i = 0; i < h; i += 1) {
          let di = d.base + (y + i) * d.rowStep + x * d.pixelStep;
          let si = s.base + i * s.rowStep;
          if (sign === 0) {
            for (
              let j = 0;
              j < w;
              j += 1, di += d.pixelStep, si += s.pixelStep
            ) {
              d.heap[di] = s.heap[si];
            }
          } else {
            for (
              let j = 0;
              j < w;
              j += 1, di += d.pixelStep, si += s.pixelStep
            ) {
              d.heap[di] += sign * s.heap[si];
            }
          }
        }
      },
      actual: () => mat[name](src, rect),
      nativePtr() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            const px = mat.floatPtr(i + rect.y, j + rect.x);
            const v = src.floatPtr(i, j)[0];
            px[0] = sign === 0 ? v : px[0] + sign * v;
          }
        }
      },
      viaPTR() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            const px = mat.PTR(i + rect.y, j + rect.x);
            const v = src.PTR(i, j)[0];
            px[0] = sign === 0 ? v : px[0] + sign * v;
          }
        }
      },
    });
  }
  for (const [name, replace] of [
    ["replaceMatOnCol", true],
    ["addOnCol", false],
  ]) {
    CASES.push({
      name: `${name} ${SIZE} rows`,
      fast: 100000,
      slow: 2000,
      reference() {
        const rows = mat.rows;
        const d = layout(mat);
        let k = d.base + COL * d.pixelStep;
        if (replace) {
          for (let i = 0; i < rows; i += 1, k += d.rowStep)
            d.heap[k] = colArr[i];
        } else {
          for (let i = 0; i < rows; i += 1, k += d.rowStep) d.heap[k] += 1;
        }
      },
      actual: replace
        ? () => mat.replaceMatOnCol(colArr, COL)
        : () => mat.addOnCol(1, COL),
      nativePtr() {
        for (let i = 0; i < SIZE; i += 1) {
          const px = mat.floatPtr(i, COL);
          px[0] = replace ? colArr[i] : px[0] + 1;
        }
      },
      viaPTR() {
        for (let i = 0; i < SIZE; i += 1) {
          const px = mat.PTR(i, COL);
          px[0] = replace ? colArr[i] : px[0] + 1;
        }
      },
    });
  }

  const IMPLS = [
    ["reference", "fast"],
    ["actual", "fast"],
    ["nativePtr", "slow"],
    ["viaPTR", "slow"],
  ];

  let failed = false;

  for (const c of CASES) {
    const rounds = Object.fromEntries(IMPLS.map(([key]) => [key, []]));
    for (let r = 0; r < ROUNDS; r += 1) {
      // Rotate the start order every round, so no implementation always runs first and pays the warm-up
      for (let k = 0; k < IMPLS.length; k += 1) {
        const [key, count] = IMPLS[(r + k) % IMPLS.length];
        rounds[key].push(perCallMicros(c[count], c[key]));
      }
    }
    const best = (key) => Math.min(...rounds[key].slice(1));
    const reference = best("reference");
    const actual = best("actual");
    const nativePtr = best("nativePtr");
    const viaPTR = best("viaPTR");
    const limit = reference * LIMIT_FACTOR;
    const us = (v) => `${v.toFixed(2).padStart(8)} µs`;
    const ratio = (v) => `${(v / reference).toFixed(2)}x`;

    console.log(
      `\n${c.name}   (time per call; fast ${c.fast} / slow ${c.slow} calls × ${ROUNDS} rounds, warm-up discarded, minimum taken)`,
    );
    console.log(
      `  reference (direct heap addressing)   ${us(reference)}   ← baseline`,
    );
    console.log(
      `  under test (dist/)                   ${us(actual)}   ${ratio(actual)}`,
    );
    console.log(
      `  regression ref (native floatPtr)     ${us(nativePtr)}   ${ratio(nativePtr)}   ← as in 3.0.0`,
    );
    console.log(
      `  regression ref (PTR per pixel)       ${us(viaPTR)}   ${ratio(viaPTR)}   ← what this gate guards against`,
    );
    console.log(`  threshold ${limit.toFixed(2)} µs`);

    if (actual > limit) {
      console.error(
        `❌ Performance regression: ${c.name} is ${ratio(actual)} the time of direct heap ` +
          `addressing. Is the loop calling an accessor per pixel again? (one language-boundary crossing and one new TypedArray per pixel)`,
      );
      failed = true;
    }
    for (const [label, value] of [
      ["native floatPtr per pixel", nativePtr],
      ["PTR per pixel", viaPTR],
    ]) {
      if (value < reference * MIN_DISCRIMINATION) {
        console.error(
          `❌ This gate can no longer tell the difference: on ${c.name}, "${label}" is only ` +
            `${ratio(value)} the reference time while the threshold is ${LIMIT_FACTOR}x, so putting ` +
            `that loop back would pass. Recalibrate LIMIT_FACTOR, or check whether Embind calls ` +
            `got cheaper (if so, re-evaluate this gate and the direct heap addressing itself ` +
            `instead of staying green).`,
        );
        failed = true;
      }
    }
  }

  mat.delete();
  src.delete();

  if (failed) {
    process.exit(1);
  }
  console.log("\n✅ performance OK");
}

main().catch((e) => {
  console.error(`❌ the gate could not run: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
