"use strict";

// 2.0 修掉的缺陷与「改用原生函数」这批替换的回归守卫。
//
// 这些用例在 1.x 的 asm.js 产物上**跑不起来**：mds() 抛异常、mulSpectrums() 返回
// NaN、replaceMatOnRow() 在非 CV_32F 上静默越界写堆。它们能存在，本身就是 2.0
// 换产物 + 重写扩展层的结果。
//
// 期望值一律独立算出（手算或纯 JS 重算），不调用被测代码反推。

const test = require("node:test");
const assert = require("node:assert");
const { getCv, DEPTHS, makeMat } = require("../helpers");

/** 逐元素比较，容差 tol。 */
function assertClose(got, want, tol, msg) {
  assert.strictEqual(got.length, want.length, `${msg}: 长度不符`);
  for (let i = 0; i < want.length; i += 1) {
    assert.ok(
      Math.abs(got[i] - want[i]) <= tol,
      `${msg}: 第 ${i} 项 ${got[i]} 与期望 ${want[i]} 相差超过 ${tol}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1.x 的 mds() —— 内部取到函数对象而非数据，100% 抛
// `src1Array.reduce is not a function`。2.0 删掉它，改用原生 cv.meanStdDev。
// ---------------------------------------------------------------------------
test("cv.meanStdDev 可用（取代 1.x 必崩的 mds()）", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.meanStdDev(src, mean, stddev);

    // 独立期望：1..9 的均值 5；总体标准差 sqrt(Σ(x-5)²/9) = sqrt(60/9)
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const wantMean = values.reduce((a, b) => a + b, 0) / values.length;
    const wantStd = Math.sqrt(
      values.reduce((a, b) => a + (b - wantMean) ** 2, 0) / values.length,
    );

    assert.strictEqual(mean.data64F[0], wantMean);
    assert.ok(
      Math.abs(stddev.data64F[0] - wantStd) < 1e-12,
      `stddev ${stddev.data64F[0]} 与手算 ${wantStd} 不符`,
    );
    assert.strictEqual(
      typeof cv.Mat.prototype.mds,
      "undefined",
      "mds() 应已从 2.0 移除",
    );
  } finally {
    src.delete();
    mean.delete();
    stddev.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x 手写的 mulSpectrums()/mulSpectrums2Channel() 把 DFT 布局算错，部分元素
// 恒为 NaN、另一部分每次运行都不同（读到未初始化的堆内存）。2.0 删掉两者，
// 白名单放行原生 cv.mulSpectrums。
// ---------------------------------------------------------------------------
test("cv.mulSpectrums 在 CCS 单通道谱上无 NaN", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
  const b = cv.matFromArray(1, 4, cv.CV_32FC1, [5, 6, 7, 8]);
  const dst = new cv.Mat();
  try {
    cv.mulSpectrums(a, b, dst, 0, false);
    const got = Array.from(dst.data32F);
    assert.ok(!got.some(Number.isNaN), `输出含 NaN: ${got.join(", ")}`);
    // CCS 布局下 1×4：[Re0, Re1, Im1, Re2]（末列是 Nyquist 项，为实数）
    // → Re0·Re0' = 1·5 = 5；(2+3i)(6+7i) = -9+32i；Re2·Re2' = 4·8 = 32
    assertClose(got, [5, -9, 32, 32], 1e-5, "CCS 谱相乘");
  } finally {
    a.delete();
    b.delete();
    dst.delete();
  }
});

test("cv.mulSpectrums 在 CV_32FC2 复数谱上与手算复数乘一致", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 2, cv.CV_32FC2, [1, 2, 3, 4]); // 1+2i, 3+4i
  const b = cv.matFromArray(1, 2, cv.CV_32FC2, [5, 6, 7, 8]); // 5+6i, 7+8i
  const dst = new cv.Mat();
  try {
    // (1+2i)(5+6i) = 5+6i+10i-12 = -7+16i；(3+4i)(7+8i) = 21+24i+28i-32 = -11+52i
    cv.mulSpectrums(a, b, dst, 0, false);
    assertClose(Array.from(dst.data32F), [-7, 16, -11, 52], 1e-5, "复数谱相乘");

    // conjB：(1+2i)(5-6i) = 5-6i+10i+12 = 17+4i；(3+4i)(7-8i) = 21-24i+28i+32 = 53+4i
    cv.mulSpectrums(a, b, dst, 0, true);
    assertClose(Array.from(dst.data32F), [17, 4, 53, 4], 1e-5, "conjB 相乘");
  } finally {
    a.delete();
    b.delete();
    dst.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x 的 svd() 走内联进产物的 numeric.js 库；2.0 删库，白名单放行 cv.SVDecomp。
// 断言方式是重构回源矩阵——这不依赖任何一份 SVD 实现的具体输出。
// ---------------------------------------------------------------------------
test("cv.SVDecomp 的分解能重构回源矩阵（取代 1.x 的 svd()）", async () => {
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
      "svd() 应已从 2.0 移除",
    );
  } finally {
    for (const m of [src, w, u, vt, wDiag, tmp, out, noop]) m.delete();
  }
});

test("cv.gemm 可做矩阵乘（取代 1.x 的 mmul()）", async () => {
  const cv = await getCv();
  // [[1,2,3],[4,5,6]] · [[7,8],[9,10],[11,12]] = [[58,64],[139,154]]（手算）
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
// 1.x 的 replaceMatOnRow 硬编码 this.floatPtr(d)。embind 的 floatPtr **不做类型
// 校验**：CV_8UC1 的 2×3 Mat（6 字节）上 floatPtr(0) 返回长度 3 的 Float32Array
// （12 字节），写入即越界 6 字节，且不报任何错。2.0 改走 PTR()。
// ---------------------------------------------------------------------------
for (const depth of DEPTHS) {
  test(`replaceMatOnRow 在 CV_${depth}C1 上写对整行`, async () => {
    const cv = await getCv();
    const type = cv[`CV_${depth}C1`];
    const mat = cv.matFromArray(2, 3, type, [1, 2, 3, 4, 5, 6]);
    try {
      mat.replaceMatOnRow([10, 20, 30], 0);
      assert.deepStrictEqual(
        Array.from(mat.DATA()),
        [10, 20, 30, 4, 5, 6],
        `CV_${depth}C1 上 replaceMatOnRow 写错（1.x 在此处静默越界写堆）`,
      );
    } finally {
      mat.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// 1.x 的 replaceMatOnPoint 形参名是 (constant, x, y) 而内部是 PTR(x, y)——x 实为
// 行号；README 记的 (value, point) 重载则根本不存在。2.0 把两者对齐。
// ---------------------------------------------------------------------------
test("replaceMatOnPoint(value, row, col) 写的是第 row 行第 col 列", async () => {
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

test("replaceMatOnPoint(value, point) 按 cv.Point 约定 x=列、y=行", async () => {
  const cv = await getCv();
  const { mat } = makeMat(cv, "32F", 1);
  try {
    mat.replaceMatOnPoint(99, new cv.Point(2, 0)); // x=2 列、y=0 行
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 99, 4, 5, 6, 7, 8, 9],
    );
    // 少给 col 时必须抛，而不是把 undefined 当下标静默写别处
    assert.throws(() => mat.replaceMatOnPoint(1, 0), TypeError);
  } finally {
    mat.delete();
  }
});

// ---------------------------------------------------------------------------
// 1.x 的 constantDivide 用 new cv.Scalar(c) 填被除数，而 Scalar 缺省分量是 0，
// 多通道时通道 1+ 被 0 除（CV_32FC3 实测填充结果 16,0,0,16,0,0）。
// ---------------------------------------------------------------------------
for (const channels of [1, 2, 3, 4]) {
  test(`constantDivide 在 CV_32FC${channels} 上各通道都正确`, async () => {
    const cv = await getCv();
    const type = cv[`CV_32FC${channels}`];
    const src = new cv.Mat(1, 2, type, new cv.Scalar(2, 2, 2, 2));
    let dst;
    try {
      dst = src.constantDivide(16); // 16 / 2 = 8，每个通道都应是 8
      const got = Array.from(dst.DATA());
      assert.deepStrictEqual(
        got,
        new Array(2 * channels).fill(8),
        `CV_32FC${channels}: 得到 ${got.join(",")}（1.x 在通道 1+ 上是 0 除）`,
      );
    } finally {
      src.delete();
      if (dst) dst.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// reshape → reshapeRows（改名 + 整除校验）；norm2 保留（原生 norm 无双 Mat 重载）
// ---------------------------------------------------------------------------
test("reshapeRows 重排为新副本，不整除时抛 RangeError", async () => {
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
      "本产物的 embind 绑定里没有 Mat::reshape —— 若哪天有了，reshapeRows 的改名理由要重写",
    );
  } finally {
    src.delete();
    if (dst) dst.delete();
  }
});

test("cv.norm2(a, b) 是 ‖a − b‖₂（原生 cv.norm 无此重载）", async () => {
  const cv = await getCv();
  const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
  const b = cv.matFromArray(1, 4, cv.CV_32FC1, [3, 4, 5, 6]);
  try {
    // 差为 (-2,-2,-2,-2)，L2 = sqrt(16) = 4
    assert.ok(Math.abs(cv.norm2(a, b) - 4) < 1e-6);
  } finally {
    a.delete();
    b.delete();
  }
});

// ---------------------------------------------------------------------------
// 2.0 不再覆盖原生方法。这条守卫在任何一次「顺手把修复盖回原生名字」的改动上
// 立刻报警。
// ---------------------------------------------------------------------------
test("1.x 的覆盖名与转义名都已消失，原生方法完好", async () => {
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
      `Mat.prototype.${name} 应已从 2.0 移除`,
    );
  }
  for (const name of ["RodriguesFromArray", "mulSpectrums2Channel"]) {
    assert.strictEqual(typeof cv[name], "undefined", `cv.${name} 应已移除`);
  }
  for (const name of ["roi", "col", "diag", "clone", "row"]) {
    assert.strictEqual(
      typeof cv.Mat.prototype[name],
      "function",
      `原生 Mat.prototype.${name} 丢失`,
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
    assert.strictEqual(typeof cv[name], "function", `原生 cv.${name} 丢失`);
  }
});
