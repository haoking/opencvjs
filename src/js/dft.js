"use strict";

/**
 * dftSplit() —— 把 cv.dft() 的 CCS-packed 单通道输出拆成实部 / 虚部两个 Mat。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️⚠️ 这个函数的正确性没有任何证据支撑，请勿在新代码里使用。            │
 * │                                                                          │
 * │ (a) 它的 CCS 展开约定**从未被独立验证过**。本仓库对它做过的全部验证只有 │
 * │     「2.0 的搬运与 1.x 逐元素一致」和「输出无 NaN」——两者都不能说明这个 │
 * │     展开约定本身是对的。                                                 │
 * │ (b) 它在 1.x 时代的唯一消费者是当时手写的 mulSpectrums()，而那个实现     │
 * │     **返回 NaN**。也就是说这条链路从来没有过可用的端到端参照，不存在    │
 * │     「它以前工作正常」这回事。                                           │
 * │ (c) 需要复数谱相乘，请直接用原生 cv.mulSpectrums(a, b, dst, flags,      │
 * │     conjB)——它直接在 CCS 格式上做乘法，根本不需要先拆分。实测           │
 * │     [1,2,3,4]×[5,6,7,8] → 5, -9, 32, 32，无 NaN。                       │
 * │                                                                          │
 * │ 保留而不删除，只因为它属于 1.x 的公开 API，删除要走废弃周期。            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * cv.dft() 不带 DFT_COMPLEX_OUTPUT 时，输出是 CCS（complex-conjugate-symmetrical）
 * 紧凑格式：实虚部交错塞在一个单通道 Mat 里，且首列 / 末列的排布与中间各列
 * 不同。OpenCV 没有导出把它展开成两个实数 Mat 的函数，所以这个手写实现保留，
 * 实现逐字搬运自 1.x。
 */

module.exports = function applyDft(cv) {
  /**
   * @deprecated 正确性未经验证，且已无消费者。需要复数谱相乘请用原生
   *   cv.mulSpectrums()。详见本文件顶部的说明。
   * @returns {{r: cv.Mat, i: cv.Mat}} 实部与虚部（调用方负责 delete）
   */
  cv.Mat.prototype.dftSplit = function dftSplit() {
    const M = this.rows;
    const N = this.cols;

    const colOneArray = [];
    const colLastArray = [];

    const realMat = cv.Mat.zeros(M, N, this.type());
    const imagMat = cv.Mat.zeros(M, N, this.type());

    for (let m = 0; m <= M - 1; m += 1) {
      colOneArray.push(this.PTR(m, 0)[0]);
      colLastArray.push(this.PTR(m, N - 1)[0]);
      for (let n = 1, i = 1; n <= N - 2; n += 2, i += 1) {
        realMat.PTR(m, i)[0] = this.PTR(m, n)[0];
        imagMat.PTR(m, i)[0] = this.PTR(m, n + 1)[0];
      }
    }

    realMat.PTR(0, 0)[0] = colOneArray[0];
    realMat.PTR(M / 2, 0)[0] = colOneArray[M - 1];
    realMat.PTR(0, N / 2)[0] = colLastArray[0];
    realMat.PTR(M / 2, N / 2)[0] = colLastArray[M - 1];
    for (let m = 1, i = 1; m <= M - 2; m += 2, i += 1) {
      realMat.PTR(i, 0)[0] = colOneArray[m];
      imagMat.PTR(i, 0)[0] = colOneArray[m + 1];

      realMat.PTR(i, N / 2)[0] = colLastArray[m];
      imagMat.PTR(i, N / 2)[0] = colLastArray[m + 1];
    }

    return { r: realMat, i: imagMat };
  };
};
