"use strict";

// Regression guards for the bugs 2.0 fixed and for the methods replaced by native
// functions.
//
// These cases **cannot run** on the 1.x asm.js artifact: mds() throws, mulSpectrums()
// returns NaN, and replaceMatOnRow() silently writes past the heap on anything other than
// CV_32F. That they exist at all is the result of 2.0's new artifacts and rewritten
// extension layer.
//
// Expected values are always computed independently (by hand or in plain JS), never
// derived from the code under test.

const test = require("node:test");
const assert = require("node:assert");
const { getCv, DEPTHS, makeMat } = require("../helpers");

/** Element-wise comparison with tolerance tol. */
function assertClose(got, want, tol, msg) {
  assert.strictEqual(got.length, want.length, `${msg}: lengths differ`);
  for (let i = 0; i < want.length; i += 1) {
    assert.ok(
      Math.abs(got[i] - want[i]) <= tol,
      `${msg}: element ${i} is ${got[i]}, more than ${tol} from the expected ${want[i]}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1.x's mds() got a function object instead of data and always threw
// `src1Array.reduce is not a function`. 2.0 removed it in favour of native cv.meanStdDev.
// ---------------------------------------------------------------------------
test("cv.meanStdDev works (replacing 1.x's always-failing mds())", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.meanStdDev(src, mean, stddev);

    // Independent expectation: the mean of 1..9 is 5; the population standard deviation
    // is sqrt(Σ(x-5)²/9) = sqrt(60/9)
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const wantMean = values.reduce((a, b) => a + b, 0) / values.length;
    const wantStd = Math.sqrt(
      values.reduce((a, b) => a + (b - wantMean) ** 2, 0) / values.length,
    );

    assert.strictEqual(mean.data64F[0], wantMean);
    assert.ok(
      Math.abs(stddev.data64F[0] - wantStd) < 1e-12,
      `stddev ${stddev.data64F[0]} does not match the hand-computed ${wantStd}`,
    );
    assert.strictEqual(
      typeof cv.Mat.prototype.mds,
      "undefined",
      "mds() should be gone since 2.0",
    );
  } finally {
    src.delete();
    mean.delete();
    stddev.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x's hand-written mulSpectrums() / mulSpectrums2Channel() got the DFT layout wrong:
// some elements were always NaN, others changed from run to run (uninitialized heap
// memory). 2.0 removed both and whitelisted native cv.mulSpectrums.
// ---------------------------------------------------------------------------
test("cv.mulSpectrums gives no NaN on a single-channel CCS spectrum", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
  const b = cv.matFromArray(1, 4, cv.CV_32FC1, [5, 6, 7, 8]);
  const dst = new cv.Mat();
  try {
    cv.mulSpectrums(a, b, dst, 0, false);
    const got = Array.from(dst.data32F);
    assert.ok(!got.some(Number.isNaN), `output has NaN: ${got.join(", ")}`);
    // 1×4 in CCS layout: [Re0, Re1, Im1, Re2] (the last column is the real Nyquist term)
    // → Re0·Re0' = 1·5 = 5; (2+3i)(6+7i) = -9+32i; Re2·Re2' = 4·8 = 32
    assertClose(got, [5, -9, 32, 32], 1e-5, "CCS spectrum product");
  } finally {
    a.delete();
    b.delete();
    dst.delete();
  }
});

test("cv.mulSpectrums on a CV_32FC2 complex spectrum matches complex multiplication by hand", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 2, cv.CV_32FC2, [1, 2, 3, 4]); // 1+2i, 3+4i
  const b = cv.matFromArray(1, 2, cv.CV_32FC2, [5, 6, 7, 8]); // 5+6i, 7+8i
  const dst = new cv.Mat();
  try {
    // (1+2i)(5+6i) = 5+6i+10i-12 = -7+16i; (3+4i)(7+8i) = 21+24i+28i-32 = -11+52i
    cv.mulSpectrums(a, b, dst, 0, false);
    assertClose(
      Array.from(dst.data32F),
      [-7, 16, -11, 52],
      1e-5,
      "complex spectrum product",
    );

    // conjB: (1+2i)(5-6i) = 5-6i+10i+12 = 17+4i; (3+4i)(7-8i) = 21-24i+28i+32 = 53+4i
    cv.mulSpectrums(a, b, dst, 0, true);
    assertClose(
      Array.from(dst.data32F),
      [17, 4, 53, 4],
      1e-5,
      "product with conjB",
    );
  } finally {
    a.delete();
    b.delete();
    dst.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x's svd() used the numeric.js library inlined into the artifact; 2.0 dropped the
// library and whitelisted cv.SVDecomp. The check reconstructs the source matrix, which
// does not depend on the exact output of any particular SVD implementation.
// ---------------------------------------------------------------------------
test("cv.SVDecomp's decomposition reconstructs the source matrix (replacing 1.x's svd())", async () => {
  const cv = await getCv();
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 10];
  const src = cv.matFromArray(3, 3, cv.CV_32FC1, values);
  const w = new cv.Mat();
  const u = new cv.Mat();
  const vt = new cv.Mat();
  const wDiag = cv.Mat.zeros(3, 3, cv.CV_32FC1);
  const tmp = new cv.Mat();
  const out = new cv.Mat();
  const noop = new cv.Mat();
  try {
    cv.SVDecomp(src, w, u, vt, 0);
    for (let i = 0; i < 3; i += 1) wDiag.floatPtr(i, i)[0] = w.data32F[i];
    cv.gemm(u, wDiag, 1, noop, 0, tmp, 0);
    cv.gemm(tmp, vt, 1, noop, 0, out, 0);
    assertClose(Array.from(out.data32F), values, 1e-4, "u·diag(w)·vt");
    assert.strictEqual(
      typeof cv.Mat.prototype.svd,
      "undefined",
      "svd() should be gone since 2.0",
    );
  } finally {
    for (const m of [src, w, u, vt, wDiag, tmp, out, noop]) m.delete();
  }
});

test("cv.gemm multiplies matrices (replacing 1.x's mmul())", async () => {
  const cv = await getCv();
  // [[1,2,3],[4,5,6]] · [[7,8],[9,10],[11,12]] = [[58,64],[139,154]] (by hand)
  const a = cv.matFromArray(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]);
  const b = cv.matFromArray(3, 2, cv.CV_32FC1, [7, 8, 9, 10, 11, 12]);
  const noop = new cv.Mat();
  const dst = new cv.Mat();
  try {
    cv.gemm(a, b, 1, noop, 0, dst, 0);
    assert.deepStrictEqual(Array.from(dst.data32F), [58, 64, 139, 154]);
    assert.strictEqual(typeof cv.Mat.prototype.mmul, "undefined");
  } finally {
    for (const m of [a, b, noop, dst]) m.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x's replaceMatOnRow hard-coded this.floatPtr(d). Embind's floatPtr **does no type
// check**: on a 2×3 CV_8UC1 Mat (6 bytes), floatPtr(0) returns a Float32Array of length 3
// (12 bytes), and writing it overruns by 6 bytes without any error. 2.0 dispatches on
// depth.
// ---------------------------------------------------------------------------
for (const depth of DEPTHS) {
  test(`replaceMatOnRow writes the whole row correctly on CV_${depth}C1`, async () => {
    const cv = await getCv();
    const type = cv[`CV_${depth}C1`];
    const mat = cv.matFromArray(2, 3, type, [1, 2, 3, 4, 5, 6]);
    try {
      mat.replaceMatOnRow([10, 20, 30], 0);
      assert.deepStrictEqual(
        Array.from(mat.DATA()),
        [10, 20, 30, 4, 5, 6],
        `replaceMatOnRow wrote the wrong values on CV_${depth}C1 (1.x silently overran the heap here)`,
      );
    } finally {
      mat.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// 1.x's replaceMatOnPoint was declared (constant, x, y) but did PTR(x, y), so x was
// actually the row; the (value, point) overload its README described did not exist.
// 2.0 made the two agree.
// ---------------------------------------------------------------------------
test("replaceMatOnPoint(value, row, col) writes row `row`, column `col`", async () => {
  const cv = await getCv();
  const { mat } = makeMat(cv, "32F", 1);
  try {
    mat.replaceMatOnPoint(99, 0, 2);
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 99, 4, 5, 6, 7, 8, 9],
    );
  } finally {
    mat.delete();
  }
});

test("replaceMatOnPoint(value, point) follows the cv.Point convention x = column, y = row", async () => {
  const cv = await getCv();
  const { mat } = makeMat(cv, "32F", 1);
  try {
    mat.replaceMatOnPoint(99, new cv.Point(2, 0)); // x = column 2, y = row 0
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 99, 4, 5, 6, 7, 8, 9],
    );
    // A missing col must throw instead of using undefined as an index and writing
    // somewhere else
    assert.throws(() => mat.replaceMatOnPoint(1, 0), TypeError);
  } finally {
    mat.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x's constantDivide filled the dividend with new cv.Scalar(c), whose other components
// default to 0, so on multi-channel Mats channels 1+ were divided by zero (CV_32FC3 was
// filled with 16,0,0,16,0,0).
// ---------------------------------------------------------------------------
for (const channels of [1, 2, 3, 4]) {
  test(`constantDivide is correct on every channel of CV_32FC${channels}`, async () => {
    const cv = await getCv();
    const type = cv[`CV_32FC${channels}`];
    const src = new cv.Mat(1, 2, type, new cv.Scalar(2, 2, 2, 2));
    let dst;
    try {
      dst = src.constantDivide(16); // 16 / 2 = 8 on every channel
      const got = Array.from(dst.DATA());
      assert.deepStrictEqual(
        got,
        new Array(2 * channels).fill(8),
        `CV_32FC${channels}: got ${got.join(",")} (1.x divided by zero on channels 1+)`,
      );
    } finally {
      src.delete();
      if (dst) dst.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// reshape → reshapeRows (renamed, with a divisibility check); norm2 stays (native norm
// has no two-Mat overload)
// ---------------------------------------------------------------------------
test("reshapeRows returns a rearranged copy and throws RangeError when the rows do not divide", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]);
  let dst;
  try {
    dst = src.reshapeRows(3);
    assert.strictEqual(dst.rows, 3);
    assert.strictEqual(dst.cols, 2);
    assert.deepStrictEqual(Array.from(dst.DATA()), [1, 2, 3, 4, 5, 6]);
    assert.throws(() => src.reshapeRows(4), RangeError);
    assert.strictEqual(
      typeof cv.Mat.prototype.reshape,
      "undefined",
      "this build's Embind bindings have no Mat::reshape; if that changes, the reason for the reshapeRows name needs rewriting",
    );
  } finally {
    src.delete();
    if (dst) dst.delete();
  }
});

test("cv.norm2(a, b) is ‖a − b‖₂ (native cv.norm has no such overload)", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
  const b = cv.matFromArray(1, 4, cv.CV_32FC1, [3, 4, 5, 6]);
  try {
    // The difference is (-2,-2,-2,-2), L2 = sqrt(16) = 4
    assert.ok(Math.abs(cv.norm2(a, b) - 4) < 1e-6);
  } finally {
    a.delete();
    b.delete();
  }
});

// ---------------------------------------------------------------------------
// Since 2.0 native methods are not overridden. This guard fires on any change that puts
// a fix back under a native name.
// ---------------------------------------------------------------------------
test("1.x's overriding and escaped names are gone and the native methods are intact", async () => {
  const cv = await getCv();
  for (const name of [
    "mds",
    "svd",
    "mmul",
    "vconcat",
    "hconcat",
    "Diag",
    "reshape",
    "RodriguesFromMat",
    "_roi",
    "_col",
  ]) {
    assert.strictEqual(
      typeof cv.Mat.prototype[name],
      "undefined",
      `Mat.prototype.${name} should be gone since 2.0`,
    );
  }
  for (const name of ["RodriguesFromArray", "mulSpectrums2Channel"]) {
    assert.strictEqual(
      typeof cv[name],
      "undefined",
      `cv.${name} should be gone`,
    );
  }
  for (const name of ["roi", "col", "diag", "clone", "row"]) {
    assert.strictEqual(
      typeof cv.Mat.prototype[name],
      "function",
      `native Mat.prototype.${name} is missing`,
    );
  }
  for (const name of [
    "gemm",
    "vconcat",
    "hconcat",
    "meanStdDev",
    "SVDecomp",
    "Rodrigues",
    "mulSpectrums",
    "norm",
  ]) {
    assert.strictEqual(
      typeof cv[name],
      "function",
      `native cv.${name} is missing`,
    );
  }
});
