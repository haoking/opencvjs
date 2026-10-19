"use strict";

// Numerical semantics of the scalar operations and norm2.
//
// Where the expected values come from:
//   - addConstant / constantSubtract / mulConstant are defined element-wise as
//     src + c / c − src / src × c (README, per method), and both the README and
//     src/js/guards.js state that ±Infinity is a valid value (the standard sentinel in
//     cost and distance maps), so ±Infinity in the data must follow IEEE-754 rather than
//     turn into NaN.
//   - norm2 is defined as ‖src1 − src2‖ (README, norm2()). The difference is the
//     mathematical one, not one saturated to the Mat's depth first — which is also how
//     OpenCV C++ norm(src1, src2, normType) treats integer input.
//   - reshapeRows(rows) returns a copy with the same data in `rows` rows (README,
//     reshapeRows()), whether or not allocating the result grows the heap.

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

test("addConstant / constantSubtract / mulConstant follow IEEE-754 on data with ±Infinity", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(1, 3, cv.CV_32FC1, [Infinity, -Infinity, 2]);
  const out = [];
  try {
    const add = src.addConstant(1);
    out.push(add);
    assert.deepStrictEqual(Array.from(add.DATA()), [Infinity, -Infinity, 3]);

    const sub = src.constantSubtract(1);
    out.push(sub);
    assert.deepStrictEqual(Array.from(sub.DATA()), [-Infinity, Infinity, -1]);

    const mul = src.mulConstant(2);
    out.push(mul);
    assert.deepStrictEqual(Array.from(mul.DATA()), [Infinity, -Infinity, 4]);
  } finally {
    src.delete();
    for (const m of out) m.delete();
  }
});

test("cv.norm2 on unsigned integers is the norm of the true difference, whatever the argument order", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 2, cv.CV_8UC1, [0, 200]);
  const b = cv.matFromArray(1, 2, cv.CV_8UC1, [10, 50]);
  try {
    // The difference is (-10, 150)
    const l2 = Math.sqrt(10 * 10 + 150 * 150);
    assert.ok(
      Math.abs(cv.norm2(a, b) - l2) < 1e-9,
      `L2 gave ${cv.norm2(a, b)}`,
    );
    assert.ok(
      Math.abs(cv.norm2(b, a) - l2) < 1e-9,
      `swapping the arguments gave ${cv.norm2(b, a)}`,
    );
    assert.strictEqual(cv.norm2(a, b, cv.NORM_L1), 160);
    assert.strictEqual(cv.norm2(a, b, cv.NORM_INF), 150);
  } finally {
    a.delete();
    b.delete();
  }
});

test("cv.norm2 does not saturate at the ends of a signed integer range", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 1, cv.CV_8SC1, [-128]);
  const b = cv.matFromArray(1, 1, cv.CV_8SC1, [127]);
  try {
    assert.strictEqual(cv.norm2(a, b, cv.NORM_INF), 255);
    assert.strictEqual(cv.norm2(a, b), 255);
  } finally {
    a.delete();
    b.delete();
  }
});

test("constantDivide on integers is saturate(c / x), without saturating the constant to the depth first", async () => {
  const cv = await getCv();
  // README: dst = constant / src1. Integer results saturate and round as usual in OpenCV,
  // and a zero divisor gives 0. The old code filled a Mat of the same depth with the
  // constant first, so on 8U 1000 became 255 and 5.4 became 5.
  const src = cv.matFromArray(1, 4, cv.CV_8UC1, [10, 4, 2, 0]);
  const out = [];
  try {
    const big = src.constantDivide(1000);
    out.push(big);
    assert.deepStrictEqual(Array.from(big.DATA()), [100, 250, 255, 0]);

    const frac = src.constantDivide(5.4);
    out.push(frac);
    // 0.54 → 1, 1.35 → 1, 2.7 → 3, zero divisor → 0
    assert.deepStrictEqual(Array.from(frac.DATA()), [1, 1, 3, 0]);
  } finally {
    src.delete();
    for (const m of out) m.delete();
  }
});

test("constantDivide on an N-D Mat (a 3-channel calcHist result) matches the 2-D result element for element", async () => {
  const cv = await getCv();
  // An N-D Mat has rows = cols = -1. The old code built the dividend from them and made
  // wasm access memory out of bounds here (RuntimeError: memory access out of bounds),
  // while addConstant and the other two kept working. Expected values: the same 64
  // numbers in a 1×64 2-D Mat, through the 2-D path.
  // prettier-ignore
  const img = cv.matFromArray(2, 2, cv.CV_8UC3, [0, 0, 0, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
  const vec = new cv.MatVector();
  const hist = new cv.Mat();
  const mask = new cv.Mat();
  const out = [];
  try {
    vec.push_back(img);
    cv.calcHist(
      vec,
      [0, 1, 2],
      mask,
      hist,
      [4, 4, 4],
      [0, 256, 0, 256, 0, 256],
    );
    assert.strictEqual(
      hist.rows,
      -1,
      "premise: this is an N-D Mat (rows / cols are -1)",
    );
    const flat = cv.matFromArray(1, 64, hist.type(), Array.from(hist.data32F));
    out.push(flat);
    const want = flat.constantDivide(8);
    out.push(want);
    const got = hist.constantDivide(8);
    out.push(got);
    assert.deepStrictEqual(Array.from(got.matSize), [4, 4, 4]);
    assert.deepStrictEqual(Array.from(got.data32F), Array.from(want.data32F));
  } finally {
    for (const m of [img, vec, hist, mask, ...out]) m.delete();
  }
});

test("cv.norm2 with NORM_RELATIVE is ‖a − b‖ / ‖b‖", async () => {
  const cv = await getCv();
  // OpenCV C++: norm(src1, src2, NORM_RELATIVE | t) = norm(src1 − src2, t) / (norm(src2, t) + DBL_EPSILON)
  const a = cv.matFromArray(1, 2, cv.CV_32FC1, [3, 0]);
  const b = cv.matFromArray(1, 2, cv.CV_32FC1, [4, 0]);
  try {
    const got = cv.norm2(a, b, cv.NORM_RELATIVE | cv.NORM_L2);
    assert.ok(Math.abs(got - 0.25) < 1e-12, `got ${got}, expected 0.25`);
    assert.ok(
      Math.abs(cv.norm2(a, b, cv.NORM_RELATIVE | cv.NORM_L1) - 0.25) < 1e-12,
    );
  } finally {
    a.delete();
    b.delete();
  }
});

test("reshapeRows is still correct when allocating the result grows wasm memory", async () => {
  const cv = await getCv();
  // Taking the source's heap view before allocating the result breaks when that
  // allocation grows the heap: the old buffer is detached and the copy throws TypeError.
  // The source takes 60% of the current heap and the result needs as much again, so the
  // heap must grow — a size a 4K image reaches on the default 128 MB initial heap.
  const before = cv.HEAPU8.buffer.byteLength;
  const n = Math.ceil((before * 0.6) / 4);
  const src = new cv.Mat(n, 1, cv.CV_32FC1);
  let out;
  try {
    const d = src.data32F;
    for (let i = 0; i < n; i += 1) d[i] = i % 251;
    out = src.reshapeRows(1);
    assert.ok(
      cv.HEAPU8.buffer.byteLength > before,
      "premise: this call should grow wasm memory, or this case tests nothing",
    );
    assert.strictEqual(out.rows, 1);
    assert.strictEqual(out.cols, n);
    const o = out.data32F;
    for (const i of [0, 1, 250, 251, n >> 1, n - 1]) {
      assert.strictEqual(o[i], i % 251, `element ${i}`);
    }
  } finally {
    src.delete();
    if (out) out.delete();
  }
});

test("cv.norm2 with NORM_HAMMING counts the differing bits of the XOR", async () => {
  const cv = await getCv();
  // OpenCV C++ norm(src1, src2, NORM_HAMMING) is popcount(src1 XOR src2), not the bits of
  // the difference: 1 XOR 2 is 0b11 (2 differing bits), while 1 − 2 saturates to 0 on 8U.
  const a = cv.matFromArray(1, 2, cv.CV_8UC1, [1, 3]);
  const b = cv.matFromArray(1, 2, cv.CV_8UC1, [2, 1]);
  try {
    assert.strictEqual(cv.norm2(a, b, cv.NORM_HAMMING), 2 + 1);
    // HAMMING2 counts 2-bit groups: 0b11 is one group, 0b10 is one group
    assert.strictEqual(cv.norm2(a, b, cv.NORM_HAMMING2), 1 + 1);
  } finally {
    a.delete();
    b.delete();
  }
});
