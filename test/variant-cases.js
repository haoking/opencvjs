"use strict";

// The table of cases that compare the baseline and simd variants numerically, and the
// **child-process runner** that executes it.
//
//   node test/variant-cases.js <baseline|simd> <output JSON path>
//
// Called by test/unit/variant-parity.test.js. It lives at the top of test/ so the
// `npm test` glob (test/*/*.test.js) does not pick it up as a test file.
//
// Why a child process
// -------------------
// The two variants **cannot be loaded in the same process**. OpenCV's UMD wrapper ends
// with
//
//     if (typeof Module === 'undefined')
//       Module = {};
//     return cv(Module);
//
// `Module = {}` has no var / let / const, and the UMD wrapper is not strict mode (the file
// has no "use strict" at all), so it creates an **implicit global**. After the first
// variant loads, globalThis.Module points at its cv object (`global.Module === cv` is
// true); when the second variant is required, `typeof Module === 'undefined'` is false,
// so it feeds the **same object** to its own factory, and Embind collides while
// registering symbols:
//     BindingError: Cannot register public name 'IntVector' twice
//
// `delete global.Module` between the two requires works around it (both instances then
// work), but this file does not do that: it would depend on the exact form of an upstream
// sloppy-mode slip. One clean process per variant depends on no such detail and also
// rules out any other cross-instance state not yet discovered.
//
// The same constraint applies to users: one variant per process. Normal use is
// unaffected (loadOpenCV() loads one), but comparing both variants in one process does
// not work.
const fs = require("fs");
const path = require("path");

/**
 * A deterministic pseudo-random source. Both variants must get byte-identical input or
 * the comparison means nothing, so Math.random() is out. A 32-bit LCG (multiplier from
 * Numerical Recipes): reproducible, with no statistical claims.
 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function bytes(n, seed) {
  const rnd = lcg(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rnd() % 256;
  return out;
}

function floats(n, seed) {
  const rnd = lcg(seed);
  const out = new Array(n);
  // The range deliberately crosses 0 and has fractions: with small integers only, a wrong
  // floating-point kernel could go unnoticed.
  for (let i = 0; i < n; i += 1) out[i] = (rnd() % 20000) / 100 - 100;
  return out;
}

/** Signed integers over CV_16S's full range: rounding bugs only show on negatives and on .5, so both are needed. */
function shorts(n, seed) {
  const rnd = lcg(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (rnd() % 65536) - 32768;
  return out;
}

/** Copies the TypedArray view matching the Mat's depth into a plain array. */
function dump(cv, mat) {
  switch (mat.depth()) {
    case cv.CV_8U:
      return Array.from(mat.data);
    case cv.CV_8S:
      return Array.from(mat.data8S);
    case cv.CV_16U:
      return Array.from(mat.data16U);
    case cv.CV_16S:
      return Array.from(mat.data16S);
    case cv.CV_32S:
      return Array.from(mat.data32S);
    case cv.CV_32F:
      return Array.from(mat.data32F);
    case cv.CV_64F:
      return Array.from(mat.data64F);
    default:
      throw new Error(`unexpected depth: ${mat.depth()}`);
  }
}

// ---------------------------------------------------------------------------
// The case table. run(cv) returns an array of numbers.
//
// exact = true  the variants must be **bit-identical**: integer kernels have no rounding
//               differences, and this project's extension methods are plain copies or
//               integer loops, so any difference is a bug.
// exact = false only max|a − b| <= tolerance × max(‖baseline‖∞, 1) is required — an
//               absolute difference normalized by the magnitude of the whole output,
//               **not** a per-element relative difference (criterion and reasons in
//               unit/variant-parity.test.js): floating-point SIMD kernels change the
//               association order of sums and multiply-adds (separable filters, dot
//               products, transforms), and last-place differences are allowed.
//
// The cases cover four groups: (1) the operations where SIMD mattered most in upstream's
// 2020 per-kernel data (resize 8UC4 1.77x / pyrDown 32FC4 3.09x / GaussianBlur 3.36x,
// and the **counterexample** blur CV_32FC1 0.519x); (2) this project's extension layer;
// (3) a few of the most common element-wise and geometric kernels; (4) "float → integer
// rounding" on signed integers (addWeighted, convertTo with scaling, and the extension
// methods built on it). Group 4 was added later: upstream's wasm SIMD backend computed
// v_round as trunc(x + 0.5), off by one for negatives and rounding .5 differently from
// cvRound, and groups 1–3 all happened to avoid that path, so CI stayed green.
// build/patches/opencv-wasm-v_round.patch fixes it; the two cases use exact operations
// (integer add / subtract, × 0.5, × 1.5), so wherever a result is exactly .5 only the
// rounding rule decides, and an unpatched simd artifact cannot pass. The sizes are kept
// small on purpose: this table compares **values**, not speed; speed is
// test/simd-compare.js's job.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: "add 8UC1 (element-wise integer)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 1));
      const b = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 2));
      const d = new cv.Mat();
      cv.add(a, b, d);
      const out = dump(cv, d);
      a.delete();
      b.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "absdiff 8UC3 (element-wise integer, multi-channel)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_8UC3, bytes(3072, 3));
      const b = cv.matFromArray(32, 32, cv.CV_8UC3, bytes(3072, 4));
      const d = new cv.Mat();
      cv.absdiff(a, b, d);
      const out = dump(cv, d);
      a.delete();
      b.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "threshold 8UC1",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 5));
      const d = new cv.Mat();
      cv.threshold(a, d, 128, 255, cv.THRESH_BINARY);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "cvtColor RGBA2GRAY (integer fixed point)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(48, 48, cv.CV_8UC4, bytes(48 * 48 * 4, 6));
      const d = new cv.Mat();
      cv.cvtColor(a, d, cv.COLOR_RGBA2GRAY);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "resize 8UC4 INTER_LINEAR (1.77x upstream)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC4, bytes(64 * 64 * 4, 7));
      const d = new cv.Mat();
      cv.resize(a, d, new cv.Size(37, 41), 0, 0, cv.INTER_LINEAR);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "resize 32FC1 INTER_LINEAR",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 8));
      const d = new cv.Mat();
      cv.resize(a, d, new cv.Size(37, 41), 0, 0, cv.INTER_LINEAR);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "GaussianBlur 8UC1 (3.36x upstream)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 9));
      const d = new cv.Mat();
      cv.GaussianBlur(a, d, new cv.Size(5, 5), 1.4, 1.4, cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "blur 32FC1 (0.519x upstream: SIMD was slower)",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 10));
      const d = new cv.Mat();
      cv.blur(a, d, new cv.Size(5, 5), new cv.Point(-1, -1), cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "pyrDown 32FC4 (3.09x upstream)",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC4, floats(64 * 64 * 4, 11));
      const d = new cv.Mat();
      cv.pyrDown(a, d, new cv.Size(0, 0), cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "Sobel 32FC1",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 12));
      const d = new cv.Mat();
      cv.Sobel(a, d, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "warpAffine 8UC1",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 13));
      // A fixed affine matrix: a slight rotation plus a translation, so it is not a plain copy.
      const m = cv.matFromArray(
        2,
        3,
        cv.CV_64FC1,
        [0.94, -0.34, 3.5, 0.34, 0.94, -2.5],
      );
      const d = new cv.Mat();
      cv.warpAffine(a, d, m, new cv.Size(64, 64));
      const out = dump(cv, d);
      a.delete();
      m.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "dft 32FC1 (floating-point sums, the most sensitive to instruction order)",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_32FC1, floats(1024, 14));
      const d = new cv.Mat();
      cv.dft(a, d, cv.DFT_COMPLEX_OUTPUT, 0);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "extension layer: roiClone / colClone / diagClone",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_32FC3, floats(32 * 32 * 3, 15));
      const r = a.roiClone(new cv.Rect(3, 5, 11, 13));
      const c = a.colClone(7);
      const g = a.diagClone();
      const out = [...dump(cv, r), ...dump(cv, c), ...dump(cv, g)];
      a.delete();
      r.delete();
      c.delete();
      g.delete();
      return out;
    },
  },
  {
    name: "extension layer: rectAdd / addOnCol / reshapeRows / norm2",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(16, 16, cv.CV_32SC1, bytes(256, 16));
      const patch = cv.matFromArray(4, 4, cv.CV_32SC1, bytes(16, 17));
      // The signature is rectAdd(src, rect) / replaceMatOnRect(src, rect): source first, rect second.
      a.rectAdd(patch, new cv.Rect(2, 3, 4, 4));
      // replaceMatOnCol(arr, col) takes an **array** first, not a Mat.
      a.replaceMatOnCol(bytes(16, 18), 5);
      // addOnCol takes a **scalar constant** first, not a Mat.
      a.addOnCol(7, 9);
      const re = a.reshapeRows(8);
      const b = cv.matFromArray(16, 16, cv.CV_32SC1, bytes(256, 19));
      const n = cv.norm2(a, b);
      const out = [...dump(cv, a), ...dump(cv, re), n];
      a.delete();
      patch.delete();
      re.delete();
      b.delete();
      return out;
    },
  },
  {
    name: "extension layer: addConstant / constantSubtract / mulConstant(0.5) 16SC1 (float → int rounding)",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_16SC1, shorts(4096, 20));
      const r1 = a.addConstant(3);
      const r2 = a.constantSubtract(7);
      // An odd number × 0.5 is exactly .5: the rounding rule decides here
      const r3 = a.mulConstant(0.5);
      const out = [...dump(cv, r1), ...dump(cv, r2), ...dump(cv, r3)];
      for (const m of [a, r1, r2, r3]) m.delete();
      return out;
    },
  },
  {
    name: "convertTo ×1.5 and addWeighted 0.5/0.5 8SC1 (float → int rounding)",
    exact: true,
    run(cv) {
      const signed = (seed) => bytes(4096, seed).map((v) => v - 128);
      const a = cv.matFromArray(64, 64, cv.CV_8SC1, signed(21));
      const b = cv.matFromArray(64, 64, cv.CV_8SC1, signed(22));
      const d1 = new cv.Mat();
      const d2 = new cv.Mat();
      a.convertTo(d1, -1, 1.5, 0);
      cv.addWeighted(a, 0.5, b, 0.5, 0, d2);
      const out = [...dump(cv, d1), ...dump(cv, d2)];
      for (const m of [a, b, d1, d2]) m.delete();
      return out;
    },
  },
];

module.exports = { CASES, lcg, bytes, floats, shorts, dump };

// --- Child-process runner ---------------------------------------------------
if (require.main === module) {
  const variant = process.argv[2];
  const outFile = process.argv[3];
  if (variant !== "baseline" && variant !== "simd") {
    console.error(
      `usage: node test/variant-cases.js <baseline|simd> <output JSON path>`,
    );
    process.exit(2);
  }
  if (!outFile) {
    // A file rather than stdout: one run of this table produces over forty thousand
    // numbers, hundreds of KB of JSON, and execFileSync's default maxBuffer is 1 MB; failures
    // near that limit are hard to understand.
    console.error("missing the output JSON path");
    process.exit(2);
  }
  const dist = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");
  // Name the variant explicitly. If it is missing, dist/index.js throws instead of falling
  // back to the other one — this is what guarantees the simd side really is simd;
  // otherwise the whole comparison would compare baseline with itself and always pass.
  require(path.join(dist, "index.js"))({ simd: variant === "simd" })
    .then((cv) => {
      const out = {};
      for (const c of CASES) out[c.name] = c.run(cv);
      fs.writeFileSync(outFile, JSON.stringify(out));
    })
    .catch((e) => {
      console.error(
        `❌ the ${variant} variant failed: ${(e && e.message) || e}`,
      );
      process.exit(1);
    });
}
