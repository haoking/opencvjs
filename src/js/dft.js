"use strict";

/**
 * dftSplit() —— 把 cv.dft() 的 CCS-packed 单通道输出拆成实部 / 虚部两个 Mat。
 *
 * cv.dft() 不带 DFT_COMPLEX_OUTPUT 时，输出是 CCS（complex-conjugate-symmetrical）
 * 紧凑格式：实虚部交错塞在一个单通道 Mat 里，且首列 / 末列的排布与中间各列
 * 不同。OpenCV 没有导出把它展开成两个实数 Mat 的函数，所以这个手写实现保留。
 *
 * 1.x 里它是 mulSpectrums() 的内部步骤；2.0 的 mulSpectrums 直接用原生的
 * cv.mulSpectrums（原生实现直接在 CCS 格式上做乘法，不需要拆分），dftSplit()
 * 因而只作为独立工具保留。
 */

module.exports = function applyDft(cv) {
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
