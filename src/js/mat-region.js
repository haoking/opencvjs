"use strict";

/**
 * Region operations and in-place writes.
 *
 * Two groups:
 *  1. roiClone / colClone / diagClone — an **independent copy** of a sub-region
 *  2. replaceMatOn* / rectAdd / rectSubtract / addOnCol — rewrite the receiver in place
 *
 * Group 2 writes pixel by pixel, addressing the wasm heap directly (typed-access's
 * pixels()) with no bounds checks on the way: an out-of-range index silently rewrites
 * somebody else's heap memory. So every method runs the guards **on entry**, proving the
 * whole index range of its loop valid once; the loop itself checks nothing.
 *
 * Why the loops do not call PTR() (which checks bounds itself) or the native *Ptr():
 * every pixel would cross the language boundary and create a new TypedArray. Direct
 * addressing is two orders of magnitude faster; the exact factors are printed as the
 * "regression reference" lines of the inplace-ops gate on every `npm run bench`, so do
 * not copy them into comments.
 *
 * Values written into integer Mats saturate like OpenCV's saturate_cast (round half to
 * even, clamp to the range, NaN becomes 0), matching addConstant and the other methods
 * that go through OpenCV; floating-point Mats are written as is.
 */

/**
 * Native roi() / col() / diag() return non-continuous views, and .data* / DATA() read
 * them as contiguous memory, returning the wrong elements (col(2) of a 3×3 CV_32FC2
 * reads 5,6,7,8,9,10 instead of 5,6,11,12,17,18).
 *
 * 1.x patched native roi() / col() / diag() themselves, which silently changed their
 * view semantics (`mat.roi(r).setTo(...)` writes back to the source Mat). Since 2.0 the
 * fixed versions have their own names and the native methods are left alone.
 */
function cloneAndRelease(view) {
  try {
    return view.clone();
  } finally {
    view.delete();
  }
}

/**
 * Reads each of rect's four fields once into a plain object; validation and addressing
 * use only this snapshot.
 *
 * rect can be any object with getters. If guards.rect, guards.covers and the
 * destructuring before the write each read it, the three reads can disagree: validation
 * sees a valid width and the write uses an out-of-range one — measured to rewrite the
 * heap past dst's data. Non-objects are passed through for guards.rect to reject.
 */
function snapshotRect(rect) {
  if (rect === null || typeof rect !== "object") return rect;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Whether the bytes read from src overlap the bytes written in dst.
 *
 * The two can be the same Mat, or two views of the same parent. Reading and writing row
 * by row, an overlap makes later pixels read values just written (writing a 3×3 Mat's
 * own Rect(0,0,2,2) into Rect(1,1,2,2) gives 1 instead of 5 in the bottom-right corner).
 * The test compares first and last bytes, so it is conservative: two interleaved views
 * that do not actually share an element also count as overlapping, which only costs an
 * extra copy. d / s are the addresses from typed-access's pixels() (their byte fields),
 * so no Embind getter is read again.
 */
function overlaps(d, x, y, s, w, h) {
  const dStart = d.byteOffset + y * d.rowBytes + x * d.pixelBytes;
  const dEnd = dStart + (h - 1) * d.rowBytes + w * d.pixelBytes;
  const sEnd = s.byteOffset + (h - 1) * s.rowBytes + w * s.pixelBytes;
  return dStart < sEnd && s.byteOffset < dEnd;
}

/**
 * Two row kernels: dh[di..] is channel 0 of the destination row and sh[si..] channel 0 of
 * the source row; each advances n pixels by its own pixel stride. With sat === null
 * (floating-point destination) values are written as is, otherwise saturated first.
 *
 * They are two small fixed-shape functions rather than one taking a (dst, src) => value
 * callback: such a callback shares one call site between three methods, V8 stops
 * inlining once it has seen three closures, and rectAdd measured 2.5× slower than
 * replaceMatOnRect. Add and subtract share a kernel and differ by `sign` (multiplying by
 * ±1 is exact).
 */
function copyRow(dh, di, dStep, sh, si, sStep, n, sat) {
  if (sat === null) {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) dh[di] = sh[si];
  } else {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] = sat(sh[si]);
    }
  }
}

function addRow(dh, di, dStep, sh, si, sStep, n, sat, sign) {
  if (sat === null) {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] += sign * sh[si];
    }
  } else {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] = sat(dh[di] + sign * sh[si]);
    }
  }
}

/**
 * Writes the region described by s into the region described by d, row by row, channel 0
 * only: a copy when sign is 0, an add / subtract when it is ±1. d and s come from
 * typed-access's pixels(), (x, y) is the origin in d, and w × h is the region size.
 *
 * A separate function, and not wrapped in try/finally on the common path: the same loop
 * inside a try block measured 1.7× slower (V8 does not optimize calls inside try blocks
 * the same way). Only the rare "src overlaps dst, copy it first" path needs a finally to
 * release the copy.
 */
function writeRect(d, s, x, y, w, h, sign) {
  const dh = d.heap;
  const sh = s.heap;
  for (let i = 0; i < h; i += 1) {
    const di = d.base + (y + i) * d.rowStep + x * d.pixelStep;
    const si = s.base + i * s.rowStep;
    if (sign === 0) {
      copyRow(dh, di, d.pixelStep, sh, si, s.pixelStep, w, d.saturate);
    } else {
      addRow(dh, di, d.pixelStep, sh, si, s.pixelStep, w, d.saturate, sign);
    }
  }
}

module.exports = function applyMatRegion(cv, guards, access) {
  /** An independent copy of a sub-rectangle (a native roi() that is safe to read directly). */
  cv.Mat.prototype.roiClone = function roiClone(rect) {
    const where = "Mat.roiClone(rect)";
    guards.mat(this, "the receiver", where);
    const r = snapshotRect(rect);
    guards.rect(this, r, where);
    return cloneAndRelease(this.roi(r));
  };

  /** An independent copy of column d (a native col() that is safe to read directly). */
  cv.Mat.prototype.colClone = function colClone(d) {
    const where = "Mat.colClone(col)";
    guards.mat(this, "the receiver", where);
    guards.index(d, this.cols, "col", where);
    return cloneAndRelease(this.col(d));
  };

  /** An independent copy of diagonal d (a native diag() that is safe to read directly). */
  cv.Mat.prototype.diagClone = function diagClone(d = 0) {
    const where = "Mat.diagClone(d)";
    guards.mat(this, "the receiver", where);
    guards.diagIndex(this, d, where);
    return cloneAndRelease(this.diag(d));
  };

  /**
   * The shared part of the three in-place rectangle writes: validate on entry → copy src
   * first if it overlaps → write channel 0 row by row. sign 0 copies src in; ±1 adds
   * ±src.
   */
  function rectInPlace(dst, src, rect, where, sign) {
    guards.mat(dst, "the receiver", where);
    guards.mat(src, "src", where);
    // Validation and the addressing below use the same snapshot; see snapshotRect().
    const r = snapshotRect(rect);
    guards.rect(dst, r, where);
    guards.covers(src, r, "src", where);
    const { x, y, width: w, height: h } = r;
    if (w === 0 || h === 0) return;

    // An unsupported depth fails here, before a copy is made for nothing.
    const d = access.pixels(dst, where);
    const s = access.pixels(src, where);
    if (!overlaps(d, x, y, s, w, h)) {
      writeRect(d, s, x, y, w, h, sign);
      return;
    }
    // src overlaps the written region: copy it first. The clone may grow wasm memory and
    // detach the heap views taken above, so both addresses are taken again after the
    // copy (see pixels()).
    const copy = src.roiClone(new cv.Rect(0, 0, w, h));
    try {
      writeRect(
        access.pixels(dst, where),
        access.pixels(copy, where),
        x,
        y,
        w,
        h,
        sign,
      );
    } finally {
      copy.delete();
    }
  }

  /** Copies channel 0 of src1 into the rectangle `rect` of this Mat (in place). */
  cv.Mat.prototype.replaceMatOnRect = function replaceMatOnRect(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.replaceMatOnRect(src, rect)", 0);
  };

  /** Overwrites every element of row d (cols × channels values) with arr, in place. */
  cv.Mat.prototype.replaceMatOnRow = function replaceMatOnRow(arr, d) {
    const where = "Mat.replaceMatOnRow(arr, row)";
    guards.mat(this, "the receiver", where);
    guards.index(d, this.rows, "row", where);
    const n = this.cols * this.channels();
    // Converted in full first: an element that cannot be converted fails the call before
    // anything is written.
    const values = guards.numbers(arr, n, "arr", where);
    const { heap, base, rowStep, saturate } = access.pixels(this, where);
    // The elements of one row are contiguous, in views too (only the rows are separated
    // by the parent's stride).
    const start = base + d * rowStep;
    for (let i = 0; i < n; i += 1) {
      const v = values[i];
      heap[start + i] = saturate === null ? v : saturate(v);
    }
  };

  /** Overwrites channel 0 of column d with arr, in place. */
  cv.Mat.prototype.replaceMatOnCol = function replaceMatOnCol(arr, d) {
    const where = "Mat.replaceMatOnCol(arr, col)";
    guards.mat(this, "the receiver", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    const values = guards.numbers(arr, rows, "arr", where);
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    let k = base + d * pixelStep;
    for (let i = 0; i < rows; i += 1, k += rowStep) {
      const v = values[i];
      heap[k] = saturate === null ? v : saturate(v);
    }
  };

  /**
   * Writes channel 0 of a single element, in place.
   *
   *   replaceMatOnPoint(value, row, col)
   *   replaceMatOnPoint(value, point)      // cv.Point convention: x = column, y = row
   */
  cv.Mat.prototype.replaceMatOnPoint = function replaceMatOnPoint(
    value,
    rowOrPoint,
    col,
  ) {
    const where = "Mat.replaceMatOnPoint(value, row, col)";
    guards.mat(this, "the receiver", where);
    // value is data written into this element, not an operand applied to the whole Mat,
    // so NaN is accepted.
    guards.value(value, "value", where);

    let row = rowOrPoint;
    let column = col;
    if (rowOrPoint !== null && typeof rowOrPoint === "object") {
      row = rowOrPoint.y;
      column = rowOrPoint.x;
    } else if (col === undefined) {
      throw new TypeError(
        "replaceMatOnPoint(value, row, col) or replaceMatOnPoint(value, point): col is missing",
      );
    }
    guards.index(row, this.rows, "row", where);
    guards.index(column, this.cols, "col", where);
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    const k = base + row * rowStep + column * pixelStep;
    heap[k] = saturate === null ? value : saturate(value);
  };

  /** Adds constant to channel 0 of every row of column d, in place. */
  cv.Mat.prototype.addOnCol = function addOnCol(constant, d) {
    const where = "Mat.addOnCol(constant, col)";
    guards.mat(this, "the receiver", where);
    guards.number(constant, "constant", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    let k = base + d * pixelStep;
    for (let i = 0; i < rows; i += 1, k += rowStep) {
      const v = heap[k] + constant;
      heap[k] = saturate === null ? v : saturate(v);
    }
  };

  /** Adds channel 0 of src1 to the rectangle `rect` of this Mat (in place). */
  cv.Mat.prototype.rectAdd = function rectAdd(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.rectAdd(src, rect)", 1);
  };

  /** Subtracts channel 0 of src1 from the rectangle `rect` of this Mat (in place). */
  cv.Mat.prototype.rectSubtract = function rectSubtract(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.rectSubtract(src, rect)", -1);
  };
};
