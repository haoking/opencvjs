"use strict";

// Performance regression gate for the region operations.
//
// Background: before 1.0.0, roi() / col() / Diag() made continuous copies by a
// cvtColor(GRAY2BGR) → operation → cvtColor(BGR2GRAY) round trip, several times slower
// than "native roi() / col() / diag() + clone()" and limited to 8U / 16U / 32F. They now
// do the latter (see the comment above cloneAndRelease in src/js/mat-region.js); since 2.0
// they are called roiClone / colClone / diagClone and the native methods are not
// overridden, so the baseline here is plain native roi().
//
// The CHANGELOG's 1.0.0 entry quotes a range over several measurements (5.8–8.6×), all
// with this fixed configuration. The original measurement:
//
//   image:      64×64 CV_32FC1
//   region:     Rect(1, 1, 32, 32)    (32×32, not the whole image, not on the edge)
//   iterations: 20000
//   result:     old (cvtColor round trip) 220 ms vs native roi + clone 31 ms ≈ 7.1x
//
// The configuration is pinned because the factor between the two implementations depends
// enormously on image and region size. Re-measured on 2026-07-27 (the deleted cvtColor
// implementation rebuilt verbatim from the parent of commit 3492caf, alternated with the
// roi() of the time in one process, warm-up discarded, node v22.22.2 / darwin-arm64, 3
// repeats per configuration, on the asm.js artifact of the time):
//
//   image     region                iters  old (cvtColor)    new (clone)      factor
//   480×640   Rect(10,10,100,100)     200  121–125 ms        2.3–2.4 ms       52–55x
//   64×64     Rect(1,1,32,32)       15000  151–154 ms        17.3–18.4 ms     8.4–8.8x
//   8×8       Rect(0,0,8,8)         15000  17–19 ms          11.3–11.6 ms     1.5–1.6x
//
// The same change is 50× on a large image with a small region and 1.5× on a small image
// with the whole region. A factor without its configuration means nothing and can be
// neither reproduced nor refuted. So N / SIZE / RECT below are the measurement this gate
// stands for, not arbitrary defaults — do not change them to "test large images"; write
// another script to measure other sizes.
//
// (Aside: the old implementation leaked an intermediate Mat per call that referenced the
// whole cvtColor intermediate image, so the leak grew with the image area — on 64×64 the
// heap ran out and aborted at call 43105, on 480×640 within a few hundred. The iteration
// counts above were chosen under that limit.)
//
// Why round 1 is discarded: this gate compares the current roiClone() with a hand-written
// native roi + clone (the old cvtColor code is gone and cannot run). roiClone() is native
// roi + clone inside, so the ratio should be close to 1x. But the first round also pays
// the one-time JIT tiering and Embind call bridge warm-up, all of it charged to whichever
// side runs first — an artifact of measurement order, not a real difference (pinned down
// with 5 experiments: swapping the order mirrored the result exactly, whoever ran first
// was slower; in separate processes the two were almost identical; alternating in one
// process, they converged from round 2 on, independent of order). So the gate runs ROUNDS
// rounds, alternates the order every round, discards round 1, and takes the minimum from
// round 2 on. If roiClone() ever goes back to a slow path such as the cvtColor round trip,
// the ratio jumps and the gate fails.
const { getCv } = require("../helpers");

const N = 20000;
const SIZE = 64;
const ROUNDS = 4; // round 1 is warm-up and discarded; the minimum of rounds 2..4 is taken

// With ROUNDS < 2, rounds.slice(1) is empty, Math.min() returns Infinity, the threshold
// becomes Infinity, and `actual > LIMIT` is always false — the gate would always print
// "✅ performance OK" while checking nothing. ROUNDS is a constant with no external input,
// so this cannot happen today, but it is exactly the "green gate that checks nothing"
// pattern, so it is closed off.
//
// console.error + process.exit rather than throw: a gate needs a clear exit code, not a
// stack trace.
if (ROUNDS < 2) {
  console.error(
    `❌ ROUNDS must be >= 2 (it is ${ROUNDS}): round 1 is warm-up and discarded, and ` +
      `with fewer than 2 rounds Math.min(...[]) === Infinity, so the threshold is void and the gate always passes.`,
  );
  process.exit(1);
}

function makeBig(cv) {
  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  return cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
}

function measure(mat, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) fn(mat);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function main() {
  const cv = await getCv();
  const RECT = new cv.Rect(1, 1, 32, 32);

  // Baseline: native roi() returns a view (not overridden since 2.0), then clone copies it.
  function baselineOp(m) {
    const v = m.roi(RECT);
    const d = v.clone();
    v.delete();
    d.delete();
  }

  // Under test: the extension layer's roiClone(), which is those two steps inside.
  function actualOp(m) {
    const d = m.roiClone(RECT);
    d.delete();
  }

  const mat = makeBig(cv);
  const baselineRounds = [];
  const actualRounds = [];

  for (let r = 0; r < ROUNDS; r += 1) {
    // Alternate the order every round, so neither side always runs first and pays the warm-up.
    if (r % 2 === 0) {
      baselineRounds.push(measure(mat, baselineOp));
      actualRounds.push(measure(mat, actualOp));
    } else {
      actualRounds.push(measure(mat, actualOp));
      baselineRounds.push(measure(mat, baselineOp));
    }
    const tag = r === 0 ? "(warm-up, discarded)" : "";
    console.log(
      `round ${r + 1}: baseline ${baselineRounds[r].toFixed(1).padStart(6)} ms` +
        `   actual ${actualRounds[r].toFixed(1).padStart(6)} ms  ${tag}`,
    );
  }
  mat.delete();

  // Discard round 1 and take the minimum of the remaining rounds for each side.
  const baseline = Math.min(...baselineRounds.slice(1));
  const actual = Math.min(...actualRounds.slice(1));

  console.log(
    `\nnative roi + clone (baseline)   ${baseline.toFixed(1)} ms / ${N} calls`,
  );
  console.log(
    `roiClone() (under test)         ${actual.toFixed(1)} ms / ${N} calls`,
  );

  // The implementation is native + clone, so the two should be close to 1x; 50% is allowed for measurement noise.
  const LIMIT = baseline * 1.5;
  console.log(
    `\nthreshold: ${LIMIT.toFixed(1)} ms   measured: ${actual.toFixed(1)} ms`,
  );

  if (actual > LIMIT) {
    console.error(
      `❌ Performance regression: roiClone() takes ${(actual / baseline).toFixed(1)}x the time of native roi + clone`,
    );
    process.exit(1);
  }
  console.log("✅ performance OK");
}

main().catch((e) => {
  console.error(`❌ the gate could not run: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
