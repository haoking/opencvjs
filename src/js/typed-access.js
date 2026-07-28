"use strict";

/**
 * 类型分发访问器：DATA() / PTR()
 *
 * OpenCV.js 的 embind 绑定按元素类型暴露不同的访问器（data / data8S / …；
 * ucharPtr / charPtr / …）。调用方要自己按 Mat 的深度挑对应的那一个，挑错
 * 会读到按错误字长重解释的字节，不报错、结果全错。DATA()/PTR() 把这层分发
 * 收进来，按 depth() 选。
 *
 * 旧实现写成 28 路 switch（7 深度 × 4 通道）。通道数不参与选择——CV_8UC1 与
 * CV_8UC4 用的是同一个 data 视图——所以这里按 depth() 查表，行为等价，且对
 * OpenCV 允许的 >4 通道 Mat 也成立（旧的 28 路 switch 在那里返回 undefined）。
 *
 * 除了两个方法，本模块还返回一个 { rawPtr } 供扩展层内部使用 —— 为什么需要它，
 * 见 PTR() 上方那段关于「校验放哪里」的实测。
 */

module.exports = function applyTypedAccess(cv, guards) {
  // OpenCV 的 depth 值 CV_8U..CV_64F 恒为 0..6，但仍从 cv 上取，避免硬编码。
  const DATA_BY_DEPTH = [];
  const PTR_BY_DEPTH = [];
  const TABLE = [
    [cv.CV_8U, "data", "ucharPtr"],
    [cv.CV_8S, "data8S", "charPtr"],
    [cv.CV_16U, "data16U", "ushortPtr"],
    [cv.CV_16S, "data16S", "shortPtr"],
    [cv.CV_32S, "data32S", "intPtr"],
    [cv.CV_32F, "data32F", "floatPtr"],
    [cv.CV_64F, "data64F", "doublePtr"],
  ];
  for (const [depth, dataProp, ptrMethod] of TABLE) {
    DATA_BY_DEPTH[depth] = dataProp;
    PTR_BY_DEPTH[depth] = ptrMethod;
  }

  /**
   * 返回覆盖整个 Mat 的 TypedArray（按元素类型定型）。
   *
   * 没有可越界的入参（不收参数），所以除了深度分发本身没有别的可校验的东西。
   *
   * ⚠️ 仅对连续 Mat 有意义。原生 roi()/col()/diag() 返回的非连续视图上，
   * 这个视图会按连续内存直读，得到错误数据 —— 见 mat-region.js 的 roiClone()。
   */
  cv.Mat.prototype.DATA = function DATA() {
    const prop = DATA_BY_DEPTH[this.depth()];
    if (prop === undefined) {
      throw new TypeError(`Mat.DATA(): 不支持的 Mat depth ${this.depth()}`);
    }
    return this[prop];
  };

  /**
   * PTR(row)      → 第 row 行的全部元素（cols × channels 个）
   * PTR(row, col) → (row, col) 处像素的各通道（channels 个）
   *
   * 行列下标都会校验。不校验的话，embind 生成的 `*Ptr` 什么都不查：3×3 CV_32FC1
   * （共 36 字节）上 `PTR(9, 9)` 返回 base+144 字节处的 Float32Array，读写都落在
   * 别人的堆上、不报任何错；小数下标则被静默截断（`PTR(1.5, 0)` 取第 1 行）。
   * PTR() 是文档化的公开 API，用户会直接调它，所以这层不能省。
   *
   * ⚠️ 校验要读 `this.rows` / `this.cols` 两个 **embind getter**，各约 11 ns ——
   * 它们是跨语言调用，不是普通属性读取。实测（同进程交替 6 轮、丢首轮、取最小值，
   * node v22.22.2 / darwin-arm64）：
   *     PTR(1, 1) 紧循环   96.2 → 143.6 ms / 200 万次   +49%（+23.7 ns/次）
   *     PTR(row) 行形式   101.4 → 132.6 ms / 200 万次   +31%（+15.6 ns/次）
   * 也就是说这层校验**不便宜**。所以扩展层内部那些逐像素的双重循环不走 PTR()，
   * 而是用下面的 rawPtr() 在循环外取一次访问器名 —— 它们的下标已经由各自的入口
   * 校验证明在范围内，再逐像素查一遍纯属重复：实测那样会让这些方法慢 **1.8–2.1x**。
   *
   * 这个倍数**不要在注释里各写各的**（这里曾经写成 38%，那是另一组对照的数字，
   * 差了将近一倍）。`npm run bench` 的 inplace-ops 门禁每次运行都会打印
   * 「退化参照（循环调 PTR）」那一行，以它为准。
   */
  cv.Mat.prototype.PTR = function PTR(row, col) {
    const where = "Mat.PTR(row, col)";
    const method = PTR_BY_DEPTH[this.depth()];
    if (method === undefined) {
      throw new TypeError(`${where}: 不支持的 Mat depth ${this.depth()}`);
    }
    guards.index(row, this.rows, "row", where);
    // 只给 row 就是「取整行」。1.x 到 2.0 这里的缺省值一直写作 -1、判据是
    // `col < 0`，于是 PTR(0, -1) 会被当成取整行而不是报错；改成 undefined 之后
    // 任何负数列号都会如实报越界。-1 这个哨兵从未出现在文档或调用方里。
    if (col === undefined) {
      return this[method](row);
    }
    guards.index(col, this.cols, "col", where);
    return this[method](row, col);
  };

  return {
    /**
     * 返回该 Mat 对应的原生访问器**方法名**（如 "floatPtr"），供扩展层在循环外
     * 取一次、循环内直接 `mat[name](i, j)` 用。
     *
     * 它跳过的是 PTR() 的边界校验，**不是**放弃校验：调用它的每个方法都已经在
     * 入口用 guards 证明了整个循环的下标范围合法。顺带也把逐像素的 depth()
     * 调用（约 5.7 ns/次）提到了循环外。
     *
     * where 由调用方传入：深度不支持时要报的是**调用方**的名字。写死成
     * "Mat.PTR(row, col)" 会让 replaceMatOnRect 里的失败谎称来自 PTR，
     * 与本层「指名道姓报出是哪个函数的哪个参数」的目标正好相反。
     */
    rawPtr(mat, where) {
      const method = PTR_BY_DEPTH[mat.depth()];
      if (method === undefined) {
        throw new TypeError(`${where}: 不支持的 Mat depth ${mat.depth()}`);
      }
      return method;
    },
  };
};
