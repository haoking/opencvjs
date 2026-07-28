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
 */

module.exports = function applyTypedAccess(cv) {
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
   * ⚠️ 仅对连续 Mat 有意义。原生 roi()/col()/diag() 返回的非连续视图上，
   * 这个视图会按连续内存直读，得到错误数据 —— 见 mat-region.js 的 roiClone()。
   */
  cv.Mat.prototype.DATA = function DATA() {
    const prop = DATA_BY_DEPTH[this.depth()];
    if (prop === undefined) {
      throw new TypeError(`DATA(): unsupported Mat depth ${this.depth()}`);
    }
    return this[prop];
  };

  /**
   * PTR(row)      → 第 row 行的全部元素（cols × channels 个）
   * PTR(row, col) → (row, col) 处像素的各通道（channels 个）
   *
   * ⚠️ **裸访问器，不查边界**，与 C++ 的 `Mat::ptr` 在 release 构建下一致。
   * 越界下标不会报错：3×3 CV_32FC1（36 字节）上 `PTR(9, 9)` 返回 base+144 字节处的
   * Float32Array，读写都落在别人的堆上；小数下标会被静默截断（`PTR(1.5, 0)` 取第 1 行）。
   *
   * 之所以不在这里加校验：一次 rows/cols 边界检查约 19 ns，而本函数自身约 54 ns
   * （实测数据见 guards.js 顶部），加上去就是 +35%，且这笔开销要由
   * replaceMatOnRect 那类双重循环里的**每个像素**来付。扩展层的每个操作都已在
   * 入口把下标校验掉，因此循环内调用本函数是安全的；直接调用 PTR() 的代码需要
   * 自己保证下标合法。
   */
  cv.Mat.prototype.PTR = function PTR(row, col = -1) {
    const method = PTR_BY_DEPTH[this.depth()];
    if (method === undefined) {
      throw new TypeError(`PTR(): unsupported Mat depth ${this.depth()}`);
    }
    return col < 0 ? this[method](row) : this[method](row, col);
  };
};
