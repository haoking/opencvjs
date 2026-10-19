"use strict";

/**
 * Scalar arithmetic, sum, reshaping by row count, and norm2.
 *
 * Everything here either has no OpenCV.js equivalent or differs from it:
 *  - addConstant / constantSubtract / mulConstant / constantDivide are fixed-argument
 *    shortcuts for convertTo / divide
 *  - sum() returns one scalar over all elements, unlike cv.sum() (a per-channel Scalar)
 *  - reshapeRows() returns a copy, unlike native reshape() (a new header sharing memory)
 *  - norm2() is ‖src1 − src2‖, with normType as in C++ cv::norm(src1, src2, normType);
 *    this build has no native two-Mat norm (see below)
 */

module.exports = function applyArithmetic(cv, guards) {
  /**
   * The four scalar operations share one entry check: the receiver must be a live Mat
   * and the constant a number (not NaN; ±Infinity is accepted, see guards.number).
   *
   * The constant check matters: convertTo / divide carry undefined / NaN all the way
   * through, and `mat.addConstant(undefined)` returns a Mat full of NaN without an error.
   * On integer Mats it is even less visible — NaN is truncated to 0.
   */
  function checkScalarOp(mat, constant, where) {
    guards.mat(mat, "the receiver", where);
    guards.number(constant, "constant", where);
  }

  /**
   * The next three are convertTo(dst, -1, alpha, beta), i.e. saturate(x·alpha + beta)
   * per element.
   *
   * This used to be addWeighted(this, alpha, this, 0, beta, dst). Its extra this·0 term
   * is NaN where the data holds ±Infinity (Infinity × 0), so adding a constant turned the
   * Infinity sentinels of cost / distance maps into NaN ([Inf, -Inf, 2] + 1 gave
   * NaN, NaN, 3). convertTo has no such term and reads the source once; on finite data
   * the two are bit-identical on the baseline variant (7 depths × 1–4 channels × 17
   * constants).
   */
  function affine(mat, alpha, beta) {
    const dst = new cv.Mat();
    mat.convertTo(dst, -1, alpha, beta);
    return dst;
  }

  /** Adds a constant to every element; returns a new Mat. */
  cv.Mat.prototype.addConstant = function addConstant(constant) {
    checkScalarOp(this, constant, "Mat.addConstant(constant)");
    return affine(this, 1, constant);
  };

  /** constant − x for every element; returns a new Mat. */
  cv.Mat.prototype.constantSubtract = function constantSubtract(constant) {
    checkScalarOp(this, constant, "Mat.constantSubtract(constant)");
    return affine(this, -1, constant);
  };

  /** Multiplies every element by a constant; returns a new Mat. */
  cv.Mat.prototype.mulConstant = function mulConstant(constant) {
    checkScalarOp(this, constant, "Mat.mulConstant(constant)");
    return affine(this, constant, 0);
  };

  /**
   * constant / x for every element; returns a new Mat. Correct for 1–4 channels.
   *
   * Computed as divide(all-ones Mat, this, dst, scale = constant), i.e.
   * saturate(constant / x). The constant goes in as the scale, not into the Mat: filling
   * it in would saturate it to the receiver's depth first — on 8U, 1000 would become 255
   * (so 1000 / 10 gave 26, not 100) and 5.4 would round to 5. Integer division by 0
   * still gives 0, guaranteed by OpenCV's own division kernel. When the constant fits the
   * depth, this is bit-identical to the old "fill with constant, scale 1" (7 depths ×
   * 1–4 channels including zero divisors, 244 cases on each variant).
   *
   * All four components of the dividend must be filled. 1.x used new cv.Scalar(constant),
   * whose other components default to 0, so on multi-channel Mats only channel 0 got the
   * value and the rest were divided by zero (CV_32FC3 was filled with 7,0,0,7,0,0).
   * cv.Mat.ones() has the same problem: it sets only channel 0 to 1 (1,0,0,1,0,0).
   *
   * cv.Scalar.all(1) is not used either: the opencv.js glue defines it as
   *   cv.Scalar.all = function (v) { return Scalar(v, v, v, v); };
   * without `new`, so `this.push` in the Scalar constructor hits undefined and the call
   * throws TypeError: this.push is not a function. That is a bug in the glue's JS helpers
   * (Scalar is not an Embind binding, so the whitelist does not matter), present in every
   * build.
   */
  cv.Mat.prototype.constantDivide = function constantDivide(constant) {
    const where = "Mat.constantDivide(constant)";
    checkScalarOp(this, constant, where);
    // A Scalar has 4 components and cannot fill a Mat with more than 4 channels; C++
    // aborts (with no information, see the top of guards.js).
    guards.channels(this, [1, 2, 3, 4], where);
    // Building the dividend from this.rows / this.cols only works for 2-D Mats. An N-D
    // Mat (e.g. the result of a 3-channel calcHist) has rows = cols = -1, and building
    // from those makes wasm access memory out of bounds (RuntimeError: memory access out
    // of bounds), so that case clones and fills with ones instead. 2-D Mats are still
    // built directly, saving a full copy.
    let dst;
    if (this.rows >= 0 && this.cols >= 0) {
      dst = new cv.Mat(
        this.rows,
        this.cols,
        this.type(),
        new cv.Scalar(1, 1, 1, 1),
      );
    } else {
      dst = this.clone();
      dst.setTo(new cv.Scalar(1, 1, 1, 1));
    }
    cv.divide(dst, this, dst, constant);
    return dst;
  };

  /**
   * The scalar sum of all elements, across channels.
   *
   * Unlike cv.sum(), which returns a per-channel Scalar (and is not exported by this
   * build).
   */
  cv.Mat.prototype.sum = function sum() {
    guards.mat(this, "the receiver", "Mat.sum()");
    // DATA() reads contiguous memory, so on views from native roi() / col() / diag() it
    // reads elements outside the view (the Rect(1,1,2,2) view of a 3×3 Mat summed to 26
    // instead of 28). Non-continuous Mats are copied first; single-row views report
    // isContinuous() === true, and DATA() is correct on them.
    if (!this.isContinuous()) {
      const copy = this.clone();
      try {
        return copy.sum();
      } finally {
        copy.delete();
      }
    }
    const data = this.DATA();
    let total = 0;
    for (let i = 0; i < data.length; i += 1) {
      total += data[i];
    }
    return total;
  };

  /**
   * Rearranges the elements into the given number of rows and returns a **new Mat**
   * (a copy).
   *
   * Called reshape(rows) in 1.x, overriding Mat.prototype. Renamed in 2.0 for two
   * reasons: native methods are not overridden (this build's Embind bindings have no
   * Mat::reshape, but widening the whitelist would collide), and the semantics differ —
   * native reshape() returns a new header sharing memory, this returns a copy.
   */
  cv.Mat.prototype.reshapeRows = function reshapeRows(rows) {
    const where = "Mat.reshapeRows(rows)";
    guards.mat(this, "the receiver", where);
    // As in the other extension methods: a non-integer is a TypeError, an invalid value
    // a RangeError.
    guards.integer(rows, "rows", where);
    const total = this.rows * this.cols;
    if (rows <= 0 || total % rows !== 0) {
      throw new RangeError(
        `${where}: the ${total} pixels of a ${this.rows}×${this.cols} Mat cannot be split evenly into ${rows} rows`,
      );
    }
    // As in sum(): DATA() on a non-continuous view does not read the view's elements, so
    // copy it first.
    if (!this.isContinuous()) {
      const copy = this.clone();
      try {
        return copy.reshapeRows(rows);
      } finally {
        copy.delete();
      }
    }
    // Allocate the result first, then take both heap views and copy. The other way round
    // (take this.DATA(), then let matFromArray allocate) breaks when that allocation grows
    // wasm memory: the view taken first is detached with the old buffer, the glue's .set()
    // throws TypeError (detached ArrayBuffer), and the new Mat leaks. It always happens
    // once the source Mat takes more than half of the heap.
    const dst = new cv.Mat(rows, total / rows, this.type());
    try {
      dst.DATA().set(this.DATA());
    } catch (e) {
      dst.delete();
      throw e;
    }
    return dst;
  };

  /**
   * ‖src1 − src2‖, the norm of the difference of two Mats.
   *
   * OpenCV C++ has a norm(src1, src2, normType, mask) overload, but **this build's Embind
   * bindings do not**: Embind dispatches on argument count only, the two norm overload
   * sets collide at 2 and 3 arguments, and the generator kept only norm(src, normType,
   * mask). Measured:
   *   cv.norm(a, b)             → C++ assertion failure (the Mat is taken as normType)
   *   cv.norm(a, b, NORM_L2)    → BindingError: Cannot pass "4" as a Mat
   *   cv.norm(a, b, NORM_L2, m) → invalid number of arguments
   * The first is the dangerous one: no type error, the Mat pointer is passed as an
   * integer normType. So this helper stays; it cannot be replaced by a native
   * cv.norm(a, b, normType).
   */
  // On integer depths cv.subtract saturates: 0 − 10 on 8U is 0, not −10, so
  // norm2([0], [10]) was 0 and only the swapped call gave 10; on 8S, −128 − 127 was clamped
  // to −128. These four norms depend only on the difference, so it is computed in CV_64F,
  // where differences of integers are exact. Floating-point depths do not saturate and
  // keep the original algorithm, bit for bit.
  const INTEGER_DEPTHS = new Set([
    cv.CV_8U,
    cv.CV_8S,
    cv.CV_16U,
    cv.CV_16S,
    cv.CV_32S,
  ]);
  const DIFF_NORMS = new Set([
    cv.NORM_INF,
    cv.NORM_L1,
    cv.NORM_L2,
    cv.NORM_L2SQR,
  ]);
  // HAMMING counts the differing bits of src1 XOR src2 (C++ defines it for CV_8UC1 only),
  // not the bits of the difference: on 8U, 1 − 2 saturates to 0 but the XOR is 0b11.
  const HAMMING_NORMS = new Set([cv.NORM_HAMMING, cv.NORM_HAMMING2]);

  cv.norm2 = function norm2(src1, src2, normType = cv.NORM_L2) {
    // cv.subtract aborts on a size or type mismatch, with no information (3×3 minus 3×4:
    // emsdk 3.1.64 builds throw a heap-pointer number, 6.0.12 builds throw
    // RuntimeError("Aborted(undefined)…"), see the top of guards.js). These two checks
    // replace that with a message that says what is wrong.
    const where = "cv.norm2(src1, src2, normType)";
    guards.mat(src1, "src1", where);
    guards.mat(src2, "src2", where);
    guards.sameSizeAndType(src1, src2, "src1", "src2", where);
    guards.integer(normType, "normType", where);

    // normType accepts exactly what C++ norm(src1, src2, normType) accepts, optionally
    // OR-ed with NORM_RELATIVE. Checking only "is an integer" let invalid values (e.g. 3)
    // reach cv.norm and abort at a C++ assertion, and silently dropped the NORM_RELATIVE
    // bit, returning the absolute norm.
    const base = normType & ~cv.NORM_RELATIVE;
    if (!DIFF_NORMS.has(base) && !HAMMING_NORMS.has(base)) {
      throw new RangeError(
        `${where}: normType = ${normType} is not a supported norm type; use NORM_INF / ` +
          `NORM_L1 / NORM_L2 / NORM_L2SQR / NORM_HAMMING / NORM_HAMMING2, ` +
          `optionally OR-ed with NORM_RELATIVE`,
      );
    }
    if (HAMMING_NORMS.has(base)) {
      guards.type(src1, [cv.CV_8UC1], "NORM_HAMMING / NORM_HAMMING2", where);
    }
    // As in C++: norm(src1 − src2, t) / (norm(src2, t) + DBL_EPSILON).
    if (base !== normType) {
      return norm2(src1, src2, base) / (cv.norm(src2, base) + Number.EPSILON);
    }

    const exact = INTEGER_DEPTHS.has(src1.depth()) && DIFF_NORMS.has(base);
    const diff = new cv.Mat();
    const noMask = exact ? new cv.Mat() : null;
    try {
      if (HAMMING_NORMS.has(base)) {
        cv.bitwise_xor(src1, src2, diff);
      } else if (exact) {
        cv.subtract(src1, src2, diff, noMask, cv.CV_64F);
      } else {
        cv.subtract(src1, src2, diff);
      }
      return cv.norm(diff, base);
    } finally {
      diff.delete();
      if (noMask) noMask.delete();
    }
  };
};
