"use strict";

/**
 * dftSplit() — splits the CCS-packed single-channel output of cv.dft() into a real and an
 * imaginary Mat.
 *
 * **Deprecated: nothing supports the correctness of this function. Do not use it in new
 * code.**
 *
 *  (a) Its CCS unpacking convention has **never been verified independently**. The only
 *      checks this repository ever made are "2.0 matches 1.x element for element" and
 *      "the output has no NaN"; neither says the convention itself is right.
 *  (b) Its only consumer in 1.x was the hand-written mulSpectrums() of the time, which
 *      **returned NaN**. The chain never had a working end-to-end reference, so "it used
 *      to work" does not apply.
 *  (c) For complex spectrum multiplication use native cv.mulSpectrums(a, b, dst, flags,
 *      conjB): it multiplies in CCS format directly, with no need to split first
 *      ([1,2,3,4] × [5,6,7,8] → 5, -9, 32, 32, no NaN).
 *
 * It is kept only because it is public API from 1.x, and removing it needs a deprecation
 * cycle.
 *
 * Without DFT_COMPLEX_OUTPUT, cv.dft() returns the compact CCS
 * (complex-conjugate-symmetrical) format: real and imaginary parts interleaved in one
 * single-channel Mat, with the first and last columns laid out differently from the
 * others. OpenCV exports no function that unpacks it into two real Mats, so this
 * hand-written implementation, carried over verbatim from 1.x, stays.
 */

module.exports = function applyDft(cv, guards) {
  /**
   * @deprecated Correctness unverified and no remaining consumer. For complex spectrum
   *   multiplication use native cv.mulSpectrums(). See the top of this file.
   * @returns {{r: cv.Mat, i: cv.Mat}} the real and imaginary parts (the caller deletes them)
   */
  cv.Mat.prototype.dftSplit = function dftSplit() {
    const where = "Mat.dftSplit()";
    guards.mat(this, "the receiver", where);
    // CCS is the **single-channel** output of cv.dft() without DFT_COMPLEX_OUTPUT, and the
    // code below reads and writes channel 0 only. On multi-channel input it drops every
    // other channel and silently returns garbage (CV_32FC2 [1..8] gave 1,0,3,0,5,0,7,0).
    guards.channels(this, [1], where);
    // Even row / column counts are deliberately **not** required. On odd sizes the code
    // relies on M/2 being truncated to an integer: on 3×3, M/2 = 1.5, which 1.x and 2.0
    // let Embind truncate to row 1 — and the only documented example is exactly 3×3, with
    // its output recorded in the docs.
    //
    // PTR() now rejects fractional indices, so the truncation is spelled out as
    // Math.trunc: **the output is unchanged** (Embind truncates towards zero as well,
    // compared element by element on 1×4 / 2×2 / 3×3 / 4×4); the behaviour that was
    // hidden inside Embind is just visible in the source now. Nothing supports the
    // unpacking convention in the first place (see the top of the file), so adding
    // validation is no excuse to change a published output.
    const M = this.rows;
    const N = this.cols;
    const midRow = Math.trunc(M / 2);
    const midCol = Math.trunc(N / 2);

    const colOneArray = [];
    const colLastArray = [];

    // Both output Mats are allocated first and filled element by element. An empty Mat
    // (the first PTR(0, 0) is out of range) or an unsupported depth throws halfway
    // through, when the caller has no reference to them yet, so they are released here.
    let realMat = null;
    let imagMat = null;
    try {
      realMat = cv.Mat.zeros(M, N, this.type());
      imagMat = cv.Mat.zeros(M, N, this.type());

      for (let m = 0; m <= M - 1; m += 1) {
        colOneArray.push(this.PTR(m, 0)[0]);
        colLastArray.push(this.PTR(m, N - 1)[0]);
        for (let n = 1, i = 1; n <= N - 2; n += 2, i += 1) {
          realMat.PTR(m, i)[0] = this.PTR(m, n)[0];
          imagMat.PTR(m, i)[0] = this.PTR(m, n + 1)[0];
        }
      }

      realMat.PTR(0, 0)[0] = colOneArray[0];
      realMat.PTR(midRow, 0)[0] = colOneArray[M - 1];
      realMat.PTR(0, midCol)[0] = colLastArray[0];
      realMat.PTR(midRow, midCol)[0] = colLastArray[M - 1];
      for (let m = 1, i = 1; m <= M - 2; m += 2, i += 1) {
        realMat.PTR(i, 0)[0] = colOneArray[m];
        imagMat.PTR(i, 0)[0] = colOneArray[m + 1];

        realMat.PTR(i, midCol)[0] = colLastArray[m];
        imagMat.PTR(i, midCol)[0] = colLastArray[m + 1];
      }

      return { r: realMat, i: imagMat };
    } catch (e) {
      if (realMat) realMat.delete();
      if (imagMat) imagMat.delete();
      throw e;
    }
  };
};
