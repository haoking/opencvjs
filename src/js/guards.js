"use strict";

/**
 * Argument validation: turns wasm aborts, which carry no information, and silent
 * out-of-bounds heap writes, which are worse, into catchable TypeError / RangeError.
 *
 * Why this layer exists (measured on an OpenCV 4.14.0 wasm build on 2026-07-28; the two
 * abort shapes in point 1 re-checked on OpenCV 5.0.0 builds made with emsdk 3.1.64 and
 * 6.0.12 on 2026-10-19):
 *
 * 1. **An abort says nothing.** The build compiles C++ exception catching out, so a
 *    failing `CV_Assert` throws something whose shape depends on the emsdk version:
 *      emsdk 3.1.64 (the 3.x releases)  `throw <bare number>` — a heap pointer: typeof
 *                                       "number", e.message is undefined, and
 *                                       e instanceof Error is false
 *      emsdk 6.0.12                     abort(): a WebAssembly.RuntimeError whose message
 *                                       is always "Aborted(undefined). Build with
 *                                       -sASSERTIONS for more info.", plus an
 *                                       "Aborted(undefined)" line on stderr
 *    (In 6.0.12 a throw with exception catching disabled goes through makeThrow() in
 *    src/parseTools.mjs, which without ASSERTIONS is a plain abort(). The ChangeLog does
 *    not say which version changed this; the premise test in test/unit/guards.test.js is
 *    the reference.)
 *    Neither shape carries the function, the argument, the offending value or OpenCV's
 *    own assertion text: the bare number makes the caller crash again on its first string
 *    operation, and the RuntimeError message is identical for every failure.
 *    Do not write concrete numbers here (this comment once quoted 1914504 / 1914528):
 *    they are heap pointers, not error codes, and change with the variant and the
 *    allocation history (1914504 on baseline was 1955632 on simd, and every later abort
 *    in the same process increments it).
 *    The module stays usable after an abort — in both shapes cv.matFromArray works
 *    normally afterwards — so the problem is the error, not a broken module.
 *
 * 2. **The worse class does not abort at all.** Embind's `*Ptr(row, col)` checks nothing:
 *      on a 3×3 CV_32FC1 (36 bytes) `mat.floatPtr(9, 9)` returns a Float32Array at
 *      base + 144 bytes, so reads and writes land on somebody else's heap, silently.
 *    replaceMatOnRect / rectAdd / rectSubtract / replaceMatOnCol / addOnCol /
 *    replaceMatOnPoint / replaceMatOnRow do not check bounds either: they address the
 *    wasm heap directly (typed-access's pixels()) with no checks on the way, so an
 *    out-of-range Rect or column is silent heap corruption. This is far more dangerous
 *    than (1), and it is the bug 1.x had in replaceMatOnRow (see CHANGELOG, 2.0.0).
 *
 * 3. **A deleted Mat is the mildest case.** Embind itself throws
 *    `BindingError: Cannot pass deleted object as a pointer of type Mat const*`, an Error
 *    with a readable message. It is still checked here to add the half Embind cannot
 *    say: which argument of which function.
 *
 * **Each index is validated once, never per pixel.** Per-call costs (node v22.22.2 /
 * darwin-arm64, 2 million calls each, best of 3 rounds):
 *
 *     mat.isDeleted()             2.1 ns      mat.rows (Embind getter)    11.0 ns
 *     Number.isInteger ×2         2.6 ns      mat.rows + mat.cols         18.8 ns
 *     mat.floatPtr(r, c)         45.6 ns      mat.depth()                  5.7 ns
 *
 * rows and cols are **Embind getters, not plain properties**: every read crosses the
 * language boundary. So the work is split:
 *
 *   - PTR() checks its own bounds, because it is documented public API that users call
 *     directly. The cost is real: +49% (+23.7 ns per call).
 *   - The extension layer's per-pixel loops do **not** go through PTR(). The guards prove
 *     the whole index range valid once on entry, and the loop then addresses the wasm
 *     heap directly through typed-access's pixels(), without calling even the native
 *     *Ptr(). Going back to PTR() per pixel (two Embind getters plus an accessor call per
 *     pixel) is two orders of magnitude slower. Do not copy factors into comments:
 *     `npm run bench` (inplace-ops) prints them on every run.
 *
 * Entry validation itself is cheap: about 26 ns for a roiClone against roughly 700 ns for
 * the call itself (under 4%), and the performance gate (npm run bench, 20000 roiClone
 * calls) shows no measurable regression.
 */

/** Describes any value for an error message. Never throws. */
function describe(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "undefined") return "undefined";
  if (t === "string") return `string ${JSON.stringify(value.slice(0, 40))}`;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") {
    return `${t} ${String(value)}`;
  }
  if (t === "function") return `function ${value.name || "<anonymous>"}`;
  try {
    const name = value.constructor && value.constructor.name;
    return name ? `${name} instance` : "object";
  } catch (_) {
    return "object";
  }
}

/** True when value[0..need) are all numbers; typed arrays other than the BigInt ones always are. */
function allNumbers(value, need) {
  if (ArrayBuffer.isView(value)) {
    return !(value instanceof BigInt64Array || value instanceof BigUint64Array);
  }
  for (let i = 0; i < need; i += 1) {
    if (typeof value[i] !== "number") return false;
  }
  return true;
}

/** value[0..need) as a Float64Array. Kept out of any try block so V8 optimizes the loop. */
function convertNumbers(value, need) {
  const out = new Float64Array(need);
  for (let i = 0; i < need; i += 1) out[i] = +value[i];
  return out;
}

/** "1 element", "3 elements". */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function convertsToNumber(v) {
  try {
    return typeof +v === "number";
  } catch (_) {
    return false;
  }
}

module.exports = function applyGuards(cv) {
  // Mat type value → name / channel count, for error messages and matFromArray's length
  // check. CV_CN_SHIFT is not hard-coded: everything is looked up from cv's own constants.
  // cv.CV_8U === cv.CV_8UC1, so C1 is registered first and the bare depth constants land
  // on the same entries.
  const TYPE_NAME = new Map();
  const TYPE_CHANNELS = new Map();
  for (let channels = 1; channels <= 4; channels += 1) {
    for (const depth of ["8U", "8S", "16U", "16S", "32S", "32F", "64F"]) {
      const name = `CV_${depth}C${channels}`;
      const value = cv[name];
      if (typeof value !== "number") continue;
      if (!TYPE_NAME.has(value)) TYPE_NAME.set(value, name);
      if (!TYPE_CHANNELS.has(value)) TYPE_CHANNELS.set(value, channels);
    }
  }

  /** Type value → "CV_32FC1(5)"; an unknown type becomes "type=<value>". */
  function typeName(type) {
    const name = TYPE_NAME.get(type);
    return name === undefined ? `type=${describe(type)}` : `${name}(${type})`;
  }

  const guards = {
    /** Must be a cv.Mat that has not been delete()d. */
    mat(value, label, where) {
      if (!(value instanceof cv.Mat)) {
        throw new TypeError(
          `${where}: ${label} must be a cv.Mat, got ${describe(value)}`,
        );
      }
      if (value.isDeleted()) {
        throw new TypeError(
          `${where}: ${label} has been deleted; a Mat cannot be used after delete()`,
        );
      }
      return value;
    },

    /**
     * A scalar **operand**: a number other than NaN. **±Infinity is accepted.**
     *
     * The two boundaries were decided separately; they are not a side effect of
     * `Number.isFinite`:
     *
     *  - Anything that is not a number is rejected. This is the bug worth catching:
     *    `mat.addConstant(undefined)` runs all the way through convertTo and returns a
     *    Mat full of NaN without an error.
     *  - NaN is rejected. As an operand it has no legitimate use — `x + NaN` / `x * NaN`
     *    wipes out the whole Mat at once — and it signals that something upstream has
     *    already gone wrong.
     *  - **±Infinity is accepted.** It is a valid IEEE-754 value and the standard sentinel
     *    in cost and distance maps. It worked before the guards existed (on CV_32FC1
     *    `addConstant(Infinity)` gives all Infinity and `mulConstant(-Infinity)` all
     *    -Infinity), so rejecting it would break correct code. An earlier version used
     *    `Number.isFinite` for brevity and did exactly that; it was reverted.
     *
     * The asymmetry with `arrayLike` / `value` is **deliberate**: this checks an
     * **operand** (one scalar applied to the whole Mat), while those paths carry **data**
     * (written into particular elements). Writing NaN into some pixels to mean "invalid
     * here" is legitimate, so they accept NaN.
     */
    number(value, label, where) {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new TypeError(
          `${where}: ${label} must be a number other than NaN (±Infinity is allowed), got ${describe(value)}`,
        );
      }
      return value;
    },

    /**
     * **Data** written into a pixel: a number; NaN and ±Infinity are both accepted.
     *
     * The difference from number() above is the operand/data asymmetry: writing NaN
     * into an element to mean "invalid here" is legitimate (the arrays of
     * replaceMatOnRow / replaceMatOnCol accept it too). Non-numbers are still rejected —
     * a string or undefined written into a TypedArray silently becomes NaN or 0.
     */
    value(value, label, where) {
      if (typeof value !== "number") {
        throw new TypeError(
          `${where}: ${label} must be a number (NaN and ±Infinity are allowed), got ${describe(value)}`,
        );
      }
      return value;
    },

    /** Must be an integer (the range is not checked). */
    integer(value, label, where) {
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${where}: ${label} must be an integer, got ${describe(value)}`,
        );
      }
      return value;
    },

    /**
     * A row / column index: an integer in [0, limit).
     *
     * Fractions must be rejected: Embind silently truncates 1.5 to 1 (on a 3×3 Mat
     * `mat.floatPtr(1.5, 0)` returns row 1), which produces a wrong result instead of
     * an error.
     */
    index(value, limit, label, where) {
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${where}: ${label} must be an integer, got ${describe(value)}`,
        );
      }
      if (limit <= 0) {
        throw new RangeError(
          `${where}: ${label} = ${value} is out of range; the Mat is empty in this dimension (length 0)`,
        );
      }
      if (value < 0 || value >= limit) {
        throw new RangeError(
          `${where}: ${label} = ${value} is out of range; the valid range is 0..${limit - 1}`,
        );
      }
      return value;
    },

    /**
     * The Rect must be well-formed and lie entirely inside the Mat.
     *
     * The conditions mirror the CV_Assert in OpenCV's `Mat::Mat(const Mat&, const Rect&)`
     * one for one:
     *   0 <= x, 0 <= width, x + width <= cols, 0 <= y, 0 <= height, y + height <= rows
     * In this build a failing assertion aborts (with no information, see the top of the
     * file).
     */
    rect(mat, rect, where) {
      if (rect === null || typeof rect !== "object") {
        throw new TypeError(
          `${where}: rect must be a cv.Rect or {x, y, width, height}, got ${describe(rect)}`,
        );
      }
      const { x, y, width, height } = rect;
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(width) ||
        !Number.isInteger(height)
      ) {
        throw new TypeError(
          `${where}: all four rect fields must be integers, got ` +
            `{x: ${describe(x)}, y: ${describe(y)}, width: ${describe(width)}, height: ${describe(height)}}`,
        );
      }
      const rows = mat.rows;
      const cols = mat.cols;
      if (
        x < 0 ||
        y < 0 ||
        width < 0 ||
        height < 0 ||
        x + width > cols ||
        y + height > rows
      ) {
        throw new RangeError(
          `${where}: Rect(x=${x}, y=${y}, width=${width}, height=${height}) does not fit ` +
            `in the ${rows}×${cols} (rows×cols) Mat; it needs 0 ≤ x and x+width ≤ cols=${cols}, ` +
            `0 ≤ y and y+height ≤ rows=${rows}`,
        );
      }
      return rect;
    },

    /** src must cover the region rect describes (otherwise the loop reads heap memory outside src). */
    covers(src, rect, label, where) {
      if (src.rows < rect.height || src.cols < rect.width) {
        throw new RangeError(
          `${where}: ${label} is ${src.rows}×${src.cols} (rows×cols), too small for the ` +
            `${rect.height}×${rect.width} region Rect(x=${rect.x}, y=${rect.y}, ` +
            `width=${rect.width}, height=${rect.height})`,
        );
      }
      return src;
    },

    /**
     * A diagonal index. OpenCV's `Mat::diag(d)` has length min(cols − d, rows) for d ≥ 0
     * and min(rows + d, cols) for d < 0, and requires a positive length with
     * `CV_DbgAssert(len > 0)` — which is a no-op in release builds, so an out-of-range d
     * is not reported: on a 3×3 Mat `diag(4)` returns a malformed Mat with rows **−1**,
     * and `diag(9)` aborts.
     */
    diagIndex(mat, d, where) {
      if (!Number.isInteger(d)) {
        throw new TypeError(
          `${where}: d must be an integer, got ${describe(d)}`,
        );
      }
      const rows = mat.rows;
      const cols = mat.cols;
      if (rows <= 0 || cols <= 0) {
        throw new RangeError(
          `${where}: an empty Mat (${rows}×${cols}) has no diagonals`,
        );
      }
      if (d <= -rows || d >= cols) {
        throw new RangeError(
          `${where}: d = ${d} is out of range; on a ${rows}×${cols} (rows×cols) Mat the ` +
            `valid range is ${-(rows - 1)}..${cols - 1} (the diagonal must not be empty)`,
        );
      }
      return d;
    },

    /** Must be array-like with at least `need` elements. */
    arrayLike(value, need, label, where) {
      if (
        value === null ||
        typeof value !== "object" ||
        typeof value.length !== "number"
      ) {
        throw new TypeError(
          `${where}: ${label} must be an array or a TypedArray, got ${describe(value)}`,
        );
      }
      if (value.length < need) {
        throw new RangeError(
          `${where}: ${label} has ${count(value.length, "element")} but ${need} are needed; ` +
            `the missing ones would be written as undefined (NaN in a float Mat, 0 in an integer Mat)`,
        );
      }
      return value;
    },

    /**
     * arrayLike() plus conversion. Returns something whose first `need` elements are all
     * numbers: `value` itself when they already are, otherwise a Float64Array converted in
     * full before the caller writes anything. Converting while writing left the Mat
     * half-written whenever an element could not be converted — `+x` throws for a BigInt,
     * a Symbol, or an object whose valueOf throws. NaN and ±Infinity pass: they are data
     * here, not operands (see number()).
     */
    numbers(value, need, label, where) {
      guards.arrayLike(value, need, label, where);
      // Fast path, by far the common case: every element already is a number, so the
      // caller can read them directly — `+x` on a number cannot throw. Skipping the copy
      // keeps replaceMatOnCol within the inplace-ops gate.
      if (allNumbers(value, need)) return value;
      try {
        return convertNumbers(value, need);
      } catch (e) {
        let i = 0;
        while (i < need && convertsToNumber(value[i])) i += 1;
        throw new TypeError(
          `${where}: ${label}[${i}] cannot be converted to a number ` +
            `(${describe(value[i])}); nothing was written`,
          { cause: e },
        );
      }
    },

    /**
     * Both Mats must have the same size and type.
     *
     * `cv.subtract` aborts on a size or type mismatch, and `cv.norm2` is built on it.
     */
    sameSizeAndType(a, b, labelA, labelB, where) {
      if (a.rows !== b.rows || a.cols !== b.cols) {
        throw new RangeError(
          `${where}: ${labelA} is ${a.rows}×${a.cols} and ${labelB} is ${b.rows}×${b.cols} ` +
            `(rows×cols); the sizes must match`,
        );
      }
      const ta = a.type();
      const tb = b.type();
      if (ta !== tb) {
        throw new TypeError(
          `${where}: ${labelA} is ${typeName(ta)} and ${labelB} is ${typeName(tb)}; ` +
            `the types must match`,
        );
      }
    },

    /**
     * The Mat's type must be one of `allowed`. `what` names the thing that imposes the
     * restriction, e.g. "NORM_HAMMING / NORM_HAMMING2", so the message says why only these
     * types are accepted.
     */
    type(mat, allowed, what, where) {
      const got = mat.type();
      if (!allowed.includes(got)) {
        throw new TypeError(
          `${where}: ${what} accepts only ${allowed.map(typeName).join(" / ")}, ` +
            `got ${typeName(got)}`,
        );
      }
      return got;
    },

    /** The Mat's channel count must be one of `allowed`. */
    channels(mat, allowed, where) {
      const got = mat.channels();
      if (!allowed.includes(got)) {
        throw new TypeError(
          `${where}: ${typeName(mat.type())} is not supported; this operation accepts ` +
            `only ${allowed.join(" / ")}-channel Mats, got ${count(got, "channel")}`,
        );
      }
      return got;
    },
  };

  // ---------------------------------------------------------------------------
  // cv.matFromArray
  //
  // The glue does `new cv.Mat(rows, cols, type)` and then `mat.dataXX.set(array)`, which
  // goes wrong silently in two ways, so both are checked before anything is allocated:
  //  - TypedArray.set() throws when the source is longer but says nothing when it is
  //    shorter: `cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3])` returns a Mat whose last
  //    six elements are whatever was on the heap.
  //  - An unknown type reaches the glue's `default: throw new Error("Type is unsupported")`
  //    only after the Mat was allocated, so every such call leaks it (measured: 300 calls
  //    on 1000×1000 grew the heap from 128 MB to 318 MB). A misspelt constant such as
  //    cv.CV_16F or cv.CV_32FC5 is undefined and lands exactly there.
  // Valid input is passed to the glue unchanged.
  //
  // Wrapped once only: cv is the same Module object every time loadOpenCV() runs (two
  // modules that each `await require("@haoking/opencvjs")()` are enough), and unlike the
  // prototype assignments elsewhere a wrapper would stack.
  // ---------------------------------------------------------------------------
  const nativeMatFromArray = cv.matFromArray;
  if (typeof nativeMatFromArray === "function" && !nativeMatFromArray.guarded) {
    cv.matFromArray = function matFromArray(rows, cols, type, array) {
      const where = "cv.matFromArray(rows, cols, type, array)";
      const channels = TYPE_CHANNELS.get(type);
      if (channels === undefined) {
        throw new TypeError(
          `${where}: type must be a CV_8U … CV_64F type with 1–4 channels ` +
            `(cv.CV_8UC1 … cv.CV_64FC4), got ${typeName(type)}`,
        );
      }
      for (const [label, n] of [
        ["rows", rows],
        ["cols", cols],
      ]) {
        guards.integer(n, label, where);
        if (n < 0) {
          throw new RangeError(
            `${where}: ${label} = ${n} must not be negative`,
          );
        }
      }
      if (
        array === null ||
        typeof array !== "object" ||
        typeof array.length !== "number"
      ) {
        throw new TypeError(
          `${where}: array must be an array or a TypedArray, got ${describe(array)}`,
        );
      }
      const need = rows * cols * channels;
      if (array.length !== need) {
        throw new RangeError(
          `${where}: a ${rows}×${cols} ${typeName(type)} Mat needs ${count(need, "element")} ` +
            `(${rows}×${cols}×${count(channels, "channel")}), got ${array.length}; ` +
            `TypedArray.set() does not complain about a short source, and the rest of ` +
            `the Mat would be uninitialized heap memory`,
        );
      }
      return nativeMatFromArray.call(this, rows, cols, type, array);
    };
    cv.matFromArray.guarded = true;
  }

  return guards;
};
