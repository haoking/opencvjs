"use strict";

// 标量运算与 norm2 的数值语义。
//
// 期望值依据：
//   - addConstant / constantSubtract / mulConstant 的定义是逐元素的
//     src + c / c − src / src × c（README 各方法的说明）；而 README 与
//     src/js/guards.js 都明确 ±Infinity 是合法值（代价图 / 距离图上的标准哨兵），
//     因此数据里的 ±Infinity 应按 IEEE-754 参与运算，而不是变成 NaN。
//   - norm2 的定义是 ‖src1 − src2‖（README 的 norm2() 一节）。差值是数学上的差，
//     不是先按 Mat 的 depth 饱和过的差——OpenCV C++ 的 norm(src1, src2, normType)
//     对整型输入也是这样算的。

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

test("addConstant / constantSubtract / mulConstant 在含 ±Infinity 的数据上按 IEEE-754 运算", async () => {
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

test("cv.norm2 在无符号整型上是真实差值的范数，与参数顺序无关", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 2, cv.CV_8UC1, [0, 200]);
  const b = cv.matFromArray(1, 2, cv.CV_8UC1, [10, 50]);
  try {
    // 差为 (-10, 150)
    const l2 = Math.sqrt(10 * 10 + 150 * 150);
    assert.ok(Math.abs(cv.norm2(a, b) - l2) < 1e-9, `L2 得 ${cv.norm2(a, b)}`);
    assert.ok(
      Math.abs(cv.norm2(b, a) - l2) < 1e-9,
      `交换参数得 ${cv.norm2(b, a)}`,
    );
    assert.strictEqual(cv.norm2(a, b, cv.NORM_L1), 160);
    assert.strictEqual(cv.norm2(a, b, cv.NORM_INF), 150);
  } finally {
    a.delete();
    b.delete();
  }
});

test("cv.norm2 在有符号整型的两端不被饱和截断", async () => {
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

test("constantDivide 在整型上是 saturate(c / x)，常数不先按 depth 饱和", async () => {
  const cv = await getCv();
  // README：dst = constant / src1。整型结果按 OpenCV 惯例饱和并舍入，除数为 0 得 0。
  // 旧实现先把常数填进一个同 depth 的 Mat，8U 上 1000 先被截成 255，5.4 先被舍成 5。
  const src = cv.matFromArray(1, 4, cv.CV_8UC1, [10, 4, 2, 0]);
  const out = [];
  try {
    const big = src.constantDivide(1000);
    out.push(big);
    assert.deepStrictEqual(Array.from(big.DATA()), [100, 250, 255, 0]);

    const frac = src.constantDivide(5.4);
    out.push(frac);
    // 0.54 → 1，1.35 → 1，2.7 → 3，除数为 0 → 0
    assert.deepStrictEqual(Array.from(frac.DATA()), [1, 1, 3, 0]);
  } finally {
    src.delete();
    for (const m of out) m.delete();
  }
});

test("cv.norm2 的 NORM_RELATIVE 是 ‖a − b‖ / ‖b‖", async () => {
  const cv = await getCv();
  // OpenCV C++ 的 norm(src1, src2, NORM_RELATIVE | t) = norm(src1 − src2, t) / (norm(src2, t) + DBL_EPSILON)
  const a = cv.matFromArray(1, 2, cv.CV_32FC1, [3, 0]);
  const b = cv.matFromArray(1, 2, cv.CV_32FC1, [4, 0]);
  try {
    const got = cv.norm2(a, b, cv.NORM_RELATIVE | cv.NORM_L2);
    assert.ok(Math.abs(got - 0.25) < 1e-12, `得 ${got}，应为 0.25`);
    assert.ok(
      Math.abs(cv.norm2(a, b, cv.NORM_RELATIVE | cv.NORM_L1) - 0.25) < 1e-12,
    );
  } finally {
    a.delete();
    b.delete();
  }
});

test("cv.norm2 的 NORM_HAMMING 数的是异或后不同的位", async () => {
  const cv = await getCv();
  // OpenCV C++ 的 norm(src1, src2, NORM_HAMMING) 是 popcount(src1 XOR src2)，
  // 不是差值的位数：1 与 2 异或得 0b11（2 位不同），而 8U 上 1 − 2 饱和成 0。
  const a = cv.matFromArray(1, 2, cv.CV_8UC1, [1, 3]);
  const b = cv.matFromArray(1, 2, cv.CV_8UC1, [2, 1]);
  try {
    assert.strictEqual(cv.norm2(a, b, cv.NORM_HAMMING), 2 + 1);
    // HAMMING2 按每 2 位一组计：0b11 是 1 组，0b10 是 1 组
    assert.strictEqual(cv.norm2(a, b, cv.NORM_HAMMING2), 1 + 1);
  } finally {
    a.delete();
    b.delete();
  }
});
