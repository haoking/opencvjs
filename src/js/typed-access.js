"use strict";

/**
 * Type-dispatching accessors: DATA() and PTR().
 *
 * Embind exposes one accessor per element type (data / data8S / …, ucharPtr / charPtr /
 * …). Picking the wrong one reinterprets the bytes with the wrong element size — no
 * error, wrong values. DATA() and PTR() pick by depth(). The channel count does not
 * matter (CV_8UC1 and CV_8UC4 share the same view), so a lookup by depth also covers
 * Mats with more than 4 channels.
 *
 * The module also returns { pixels } for the extension layer's per-pixel writes; see
 * PTR() for why those loops do not go through PTR().
 */

/**
 * Saturation for writes into integer Mats, matching OpenCV's saturate_cast: round half
 * to even (cvRound), then clamp to the depth's range; NaN becomes 0.
 *
 * Assigning to a Uint8Array and friends follows different rules — wrap modulo 2^n and
 * truncate (250 + 20 written to 8U gives 14) — which is what the in-place writes did
 * before, contradicting addConstant (which goes through OpenCV and gives 255).
 */
function saturator(lo, hi) {
  return (v) => {
    if (v >= hi) return hi;
    if (v <= lo) return lo;
    if (v !== v) return 0; // NaN
    const r = Math.round(v); // .5 always rounds towards +∞
    return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r; // exactly .5 onto an odd number: take the even one
  };
}

module.exports = function applyTypedAccess(cv, guards) {
  // CV_8U..CV_64F are 0..6, but read from cv rather than hard-coded.
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

  // depth → the wasm heap view of that element type, bytes per element, and the
  // saturation applied on write (null for floating point).
  const HEAP_BY_DEPTH = [];
  for (const [depth, heap, bytes, lo, hi] of [
    [cv.CV_8U, "HEAPU8", 1, 0, 255],
    [cv.CV_8S, "HEAP8", 1, -128, 127],
    [cv.CV_16U, "HEAPU16", 2, 0, 65535],
    [cv.CV_16S, "HEAP16", 2, -32768, 32767],
    [cv.CV_32S, "HEAP32", 4, -2147483648, 2147483647],
    [cv.CV_32F, "HEAPF32", 4],
    [cv.CV_64F, "HEAPF64", 8],
  ]) {
    HEAP_BY_DEPTH[depth] = {
      heap,
      bytes,
      saturate: lo === undefined ? null : saturator(lo, hi),
    };
  }

  /**
   * A TypedArray over the whole Mat, typed by element type. Takes no arguments, so there
   * is nothing to validate beyond the depth.
   *
   * Meaningful for continuous Mats only: on the non-continuous views returned by native
   * roi() / col() / diag() it reads contiguous memory and returns the wrong elements —
   * use roiClone() / colClone() / diagClone() (mat-region.js) to read those.
   *
   * Like every data* view it is a window onto the wasm heap: anything that may allocate
   * wasm memory afterwards (a new Mat, clone(), most cv.* calls) can grow the heap and
   * detach it. Take the view after allocating, not before.
   */
  cv.Mat.prototype.DATA = function DATA() {
    const prop = DATA_BY_DEPTH[this.depth()];
    if (prop === undefined) {
      throw new TypeError(`Mat.DATA(): unsupported Mat depth ${this.depth()}`);
    }
    return this[prop];
  };

  /**
   * PTR(row)      → every element of row `row` (cols × channels)
   * PTR(row, col) → the channels of the pixel at (row, col)
   *
   * Both indices are validated. Embind's *Ptr accessors check nothing: on a 3×3 CV_32FC1
   * (36 bytes), floatPtr(9, 9) returns a view 144 bytes past the start, into somebody
   * else's memory, and a fractional index is silently truncated. PTR() is documented
   * public API, so the check stays.
   *
   * The check is not free: rows and cols are Embind getters, i.e. a call across the
   * language boundary each time (about +50% for PTR(r, c) in a tight loop). That is why
   * the extension layer's own per-pixel loops do not use PTR(): they validate the whole
   * index range once on entry and then address the heap directly through pixels() below,
   * without calling any accessor. Going back to PTR() per pixel is two orders of
   * magnitude slower — `npm run bench` (inplace-ops) prints the exact factors on every run.
   */
  cv.Mat.prototype.PTR = function PTR(row, col) {
    const where = "Mat.PTR(row, col)";
    const method = PTR_BY_DEPTH[this.depth()];
    if (method === undefined) {
      throw new TypeError(`${where}: unsupported Mat depth ${this.depth()}`);
    }
    guards.index(row, this.rows, "row", where);
    // No col means "the whole row". This default used to be -1 with a `col < 0` test,
    // which made PTR(0, -1) return a row instead of failing; with undefined every
    // negative column is reported as out of range.
    if (col === undefined) {
      // Embind's *Ptr(row) returns step1(0) elements — the *parent's* row stride. On a
      // view from native roi() / col() that runs past the row, and past the whole buffer
      // on the last row: on the 1×1 bottom-right view of a 2×64 Mat it returned 63 extra
      // bytes, and replaceMatOnRow wrote them into the next allocation. Single-row views
      // report isContinuous() === true and are affected too, so continuity is not a test:
      // always cut the view to cols × channels (a no-op on continuous Mats).
      const view = this[method](row);
      const len = this.cols * this.channels();
      return view.length === len ? view : view.subarray(0, len);
    }
    guards.index(col, this.cols, "col", where);
    return this[method](row, col);
  };

  return {
    /**
     * Direct addressing of a Mat's data: the wasm heap view matching its depth, plus the
     * start and strides counted in elements.
     *
     *   index of channel k at (r, c) = base + r * rowStep + c * pixelStep + k
     *
     * This holds for views from native roi() / col() too: base comes from the view's own
     * first element (data.byteOffset) and rowStep from step[0], which on a view is the
     * parent's row stride.
     *
     * Not bounds-checked: callers must prove the whole index range valid with guards
     * first.
     *
     * `heap` is the heap view at the time of the call. After anything that may allocate
     * wasm memory (clone(), for instance) call pixels() again: when memory grows,
     * Emscripten replaces the buffer and reassigns cv.HEAP*, and old views become
     * detached (length 0, writes lost). byteOffset / rowBytes / pixelBytes are the same
     * addresses in bytes, for overlap checks without reading the Embind getters again.
     * (A getter for `heap` was tried and made a column write 0.31 → 0.49 µs.)
     *
     * `where` names the caller, so an unsupported depth is reported against the method
     * the user actually called.
     */
    pixels(mat, where) {
      const info = HEAP_BY_DEPTH[mat.depth()];
      if (info === undefined) {
        throw new TypeError(`${where}: unsupported Mat depth ${mat.depth()}`);
      }
      const byteOffset = mat.data.byteOffset;
      const rowBytes = mat.step[0];
      const pixelBytes = mat.elemSize();
      // OpenCV aligns allocations and views to whole elements; this is only a safeguard
      // against addressing by element when that does not hold.
      if (byteOffset % info.bytes !== 0 || rowBytes % info.bytes !== 0) {
        throw new Error(
          `${where}: the Mat's data address or row step is not aligned to whole ` +
            `elements, so it cannot be addressed by element`,
        );
      }
      return {
        heap: cv[info.heap],
        base: byteOffset / info.bytes,
        rowStep: rowBytes / info.bytes,
        pixelStep: pixelBytes / info.bytes,
        saturate: info.saturate,
        byteOffset,
        rowBytes,
        pixelBytes,
      };
    },
  };
};
