# Migrating from 1.x to 2.0

2.0 replaced the artifact (the 2018 asm.js build of OpenCV 4.0.1 → a self-built
WebAssembly build of OpenCV 4.14.0) and rewrote the hand-written extension layer from a
patch inside that single file into separate modules shipped with the package.

The breaking changes fall into three groups:

1. **Loading**: the package entry returns a Promise and must be awaited.
2. **Native OpenCV methods are no longer overridden**: `roi` / `col` / `diag` /
   `reshape` behave as upstream again, and this project's fixed versions are called
   `roiClone` / `colClone` / `diagClone` / `reshapeRows`.
3. **8 hand-written methods were removed** in favour of native equivalents (several of the
   1.x versions were broken anyway).

Each change below comes with the replacement code. Later releases changed more (see
[CHANGELOG.md](../CHANGELOG.md)); the outputs shown here are still what the current build
prints, and the error messages are quoted in their current wording.

---

## 1. Loading

**1.x** (synchronous: `require` returned `cv`):

```javascript
const cv = require("@haoking/opencvjs");
const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
```

**2.0 and later** (the entry is an async function returning a Promise):

```javascript
const loadCV = require("@haoking/opencvjs");

(async () => {
  const cv = await loadCV();
  const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  console.log("mat::" + mat.data32F); //mat::1,2,3,4,5,6,7,8,9
  mat.delete();
})();
```

To test readiness, check `typeof cv.Mat === "function"`. Do not use
`cv.onRuntimeInitialized`: artifacts built with older Emscripten kept that property after
initialization, so waiting for it never ended — this project's first CI smoke test hung
exactly that way.

The artifact is no longer a single `.js` file: it is `opencv.js` (glue) plus
`opencv_js.wasm`, which must stay side by side under those names. The extension layer is
CommonJS; in a browser, use a bundler. Since 2.1 the package holds two such pairs,
`dist/baseline/` and `dist/simd/`, and the entry picks one at runtime; only code that
deep-imported `@haoking/opencvjs/dist/opencv.js` needs changing for that.

---

## 2. Renamed: native methods are no longer overridden

1.x put its fixes directly on OpenCV's native `roi()` / `col()` / `diag()`, which silently
changed their **view semantics**: `mat.roi(rect).setTo(...)` no longer wrote back to the
source Mat, and reported nothing. 2.0 leaves the native methods alone and gives the fixed
versions their own names.

| 1.x                 | 2.0                     | Notes                                                       |
| ------------------- | ----------------------- | ----------------------------------------------------------- |
| `mat.roi(rect)`     | `mat.roiClone(rect)`    | returns an independent, continuous copy; `.data*` reads it  |
| `mat.col(d)`        | `mat.colClone(d)`       | same                                                        |
| `mat.Diag(d)`       | `mat.diagClone(d)`      | same (note the capital `D` in 1.x)                          |
| `mat._roi(rect)`    | `mat.roi(rect)`         | the 1.x escape name is gone: the native method is untouched |
| `mat._col(d)`       | `mat.col(d)`            | same                                                        |
| `mat.reshape(rows)` | `mat.reshapeRows(rows)` | see below                                                   |

Which one to use: **`*Clone` to read the data, the native method to write back into the
source.**

```javascript
// Reading needs a copy: a native view is not continuous, and .data* reads it as
// contiguous memory, which gives the wrong data
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
console.log("col::" + m.col(2).data32F); //col::3,4,5        ← wrong (the view is not continuous)
console.log("colClone::" + m.colClone(2).data32F); //colClone::3,6,9   ← right

// Writing back needs the native view; writing to a copy does not reach the source
const view = m.roi(new cv.Rect(1, 1, 2, 2));
view.setTo(new cv.Scalar(0, 0, 0, 0));
console.log("m::" + m.data32F); //m::1,2,3,4,0,0,7,0,0
```

The difference is larger on multi-channel Mats (3×3 `CV_32FC2`, values 1..18):

```javascript
// prettier-ignore
const m2 = cv.matFromArray(3, 3, cv.CV_32FC2,
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
console.log("col::" + m2.col(2).data32F); //col::5,6,7,8,9,10        ← wrong
console.log("colClone::" + m2.colClone(2).data32F); //colClone::5,6,11,12,17,18   ← right
```

**`reshape` was renamed for a different reason**: this build's Embind bindings have no
`Mat::reshape` at all (`typeof cv.Mat.prototype.reshape === "undefined"`), so 1.x did not
override anything. The rename frees the name (widening the whitelist would collide) and
makes the semantic difference explicit: native `reshape()` returns a header sharing
memory, `reshapeRows()` returns a **copy**. 2.0 also checks that the row count divides the
pixel count:

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const flat = m.reshapeRows(1); // 1×9
try {
  m.reshapeRows(4);
} catch (e) {
  console.log(e.message);
  //Mat.reshapeRows(rows): the 9 pixels of a 3×3 Mat cannot be split evenly into 4 rows
}
```

---

## 3. Removed: use the native equivalents

These methods do not exist since 2.0 (`typeof` is `undefined`). The whitelist exposes the
native functions instead, compared against the old behaviour by measurement.

### `mat.mmul(b)` → `cv.gemm`

```javascript
const a = cv.matFromArray(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]);
const b = cv.matFromArray(3, 2, cv.CV_32FC1, [7, 8, 9, 10, 11, 12]);
const noop = new cv.Mat(); // gemm's src3; unused when beta = 0
const dst = new cv.Mat();
cv.gemm(a, b, 1, noop, 0, dst, 0);
console.log("dst::" + dst.data32F); //dst::58,64,139,154
```

### `mat.vconcat(b)` / `mat.hconcat(b)` → `cv.vconcat` / `cv.hconcat`

The argument changes from a Mat to a MatVector:

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const vec = new cv.MatVector();
vec.push_back(m);
vec.push_back(m);

const v = new cv.Mat();
cv.vconcat(vec, v);
console.log("v::" + v.data32F + " " + v.rows + "x" + v.cols);
//v::1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9 6x3

const h = new cv.Mat();
cv.hconcat(vec, h);
console.log("h::" + h.data32F + " " + h.rows + "x" + h.cols);
//h::1,2,3,1,2,3,4,5,6,4,5,6,7,8,9,7,8,9 3x6
```

### `mat.mds()` → `cv.meanStdDev`

1.x's `mds()` **always threw** (`TypeError: src1Array.reduce is not a function`: the code
used `this.DATA` instead of `this.DATA()` and got the function object). It never worked,
so this change cannot break running code.

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const mean = new cv.Mat();
const stddev = new cv.Mat();
cv.meanStdDev(m, mean, stddev);
console.log(mean.data64F[0] + " " + stddev.data64F[0]); //5 2.5819888974716108
```

### `mat.svd()` → `cv.SVDecomp`

1.x used the numeric.js library inlined into the artifact; 2.0 removed the library in
favour of native `cv.SVDecomp(src, w, u, vt, flags)`. (Only the function is bound; there
is no `cv.SVD` class.)

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const w = new cv.Mat();
const u = new cv.Mat();
const vt = new cv.Mat();
cv.SVDecomp(m, w, u, vt, 0);
console.log("w::" + w.data32F);
//w::16.848102569580078,1.0683696269989014,1.1560786106201704e-8
```

The singular values match 1.x's `numeric.svd`; the third is 0 because
`[[1,2,3],[4,5,6],[7,8,9]]` has rank 2.

### `cv.RodriguesFromArray(arr)` / `mat.RodriguesFromMat()` → `cv.Rodrigues`

Native `cv.Rodrigues(src, dst)` works in both directions and picks one from the input's
shape:

```javascript
const rvec = cv.matFromArray(3, 1, cv.CV_32FC1, [0.1, 0.2, 0.3]);
const R = new cv.Mat();
cv.Rodrigues(rvec, R); // 3×3 rotation matrix

const back = new cv.Mat();
cv.Rodrigues(R, back);
console.log("back::" + back.data32F);
//back::0.10000000149011612,0.20000000298023224,0.30000004172325134
```

### `cv.mulSpectrums(a, b, conjB)` / `cv.mulSpectrums2Channel(...)` → native `cv.mulSpectrums`

Both 1.x versions **returned invalid results**: some elements were always `NaN`, others
changed from run to run (uninitialized heap memory). 2.0 whitelists the native
`mulSpectrums`.

The signature becomes `cv.mulSpectrums(a, b, dst, flags, conjB)`, with an output `dst` and
a `flags` argument:

```javascript
// Compact CCS format (the single-channel output of cv.dft without DFT_COMPLEX_OUTPUT)
const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
const b = cv.matFromArray(1, 4, cv.CV_32FC1, [5, 6, 7, 8]);
const dst = new cv.Mat();
cv.mulSpectrums(a, b, dst, 0, false);
console.log("dst::" + dst.data32F); //dst::5,-9,32,32

// Two-channel complex format (replaces mulSpectrums2Channel)
const c1 = cv.matFromArray(1, 2, cv.CV_32FC2, [1, 2, 3, 4]); // 1+2i, 3+4i
const c2 = cv.matFromArray(1, 2, cv.CV_32FC2, [5, 6, 7, 8]); // 5+6i, 7+8i
const d2 = new cv.Mat();
cv.mulSpectrums(c1, c2, d2, 0, false);
console.log("d2::" + d2.data32F); //d2::-7,16,-11,52   ← (1+2i)(5+6i), (3+4i)(7+8i)
cv.mulSpectrums(c1, c2, d2, 0, true);
console.log("d2::" + d2.data32F); //d2::17,4,53,4      ← conjB
```

The native version returns as many channels as its input (1.x returned
`channels() === 1` for `CV_32FC2` input).

---

## 4. Corrected signatures (same name, callers may need changes)

### `mat.replaceMatOnPoint`

1.x declared the parameters as `(constant, x, y)` but called `PTR(x, y)`, so `x` was
actually the **row** and `y` the **column**, the opposite of what the names suggested.
The `(value, point)` overload the old README described did not exist (passing an object
threw `TypeError: Cannot convert "[object Object]" to int`).

2.0 makes both work:

```javascript
const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

mat.replaceMatOnPoint(30, 1, 1); // (value, row, col)
console.log("mat::" + mat.data32F); //mat::1,2,3,4,30,6,7,8,9

mat.replaceMatOnPoint(99, new cv.Point(2, 0)); // (value, point): cv.Point has x = column, y = row
console.log("mat::" + mat.data32F); //mat::1,2,99,4,30,6,7,8,9

try {
  mat.replaceMatOnPoint(1, 0);
} catch (e) {
  console.log(e.message);
  //replaceMatOnPoint(value, row, col) or replaceMatOnPoint(value, point): col is missing
}
```

**Positional behaviour did not change**: 1.x did `this.PTR(x, y)[0] = constant`, so the
second argument was always the row and the third the column, exactly as 2.0's
`PTR(row, col)`. Only the misleading parameter names changed, and the `(value, point)`
overload was added. **Existing three-argument calls keep working**; what changes is that
calls written against the documented `(value, point)` form, which used to throw, now work.

### `mat.replaceMatOnRow`

1.x hard-coded `this.floatPtr(d)`. The old README described this as "CV_32F only", but it
did **not** throw — it **silently corrupted memory**: Embind's `floatPtr` does no type
check, so on a 2×3 `CV_8UC1` Mat (6 bytes) `floatPtr(0)` returned a `Float32Array` of
length 3 (12 bytes), and writing it overran by 6 bytes without any error.

2.0 dispatches on the Mat's depth, and all seven depths are correct:

```javascript
// 2×3 with values 1..6; replace row 0 with [10, 20, 30]
// 1.x: CV_8UC1 → 0,0,32,65,0,0 plus a 6-byte overrun; CV_32SC1 → 1092616192,1101004800,...
// 2.0: 10,20,30,4,5,6 on every depth
const mat = cv.matFromArray(2, 3, cv.CV_8UC1, [1, 2, 3, 4, 5, 6]);
mat.replaceMatOnRow([10, 20, 30], 0);
console.log("mat::" + mat.DATA()); //mat::10,20,30,4,5,6
```

### `mat.constantDivide`

Same name and signature, **corrected behaviour**: 1.x filled the dividend with
`new cv.Scalar(constant)`, whose other components default to 0, so on multi-channel Mats
channels 1+ were divided by zero (filling a `CV_32FC3` gave `16,0,0,16,0,0`). Since 2.0
every channel count from 1 to 4 is correct:

```javascript
const m = new cv.Mat(1, 2, cv.CV_32FC3, new cv.Scalar(2, 2, 2, 2));
console.log("dst::" + m.constantDivide(16).data32F); //dst::8,8,8,8,8,8
```

---

## 5. Unchanged

- `DATA()` / `PTR()`: reimplemented as a lookup by `depth()` instead of a 28-way switch;
  equivalent, and also correct for the >4-channel Mats OpenCV allows (the old code
  returned `undefined` there). `PTR`'s parameters are now named `(row, col)` instead of
  `(x, y)`; the meaning was always row, column.
- `addConstant` / `constantSubtract` / `mulConstant` / `sum`
- `replaceMatOnRect` / `replaceMatOnCol` / `addOnCol` / `rectAdd` / `rectSubtract`
- `cv.norm2(a, b)`: **keep it; do not switch to native `cv.norm(a, b, normType)`**, which
  this build does not have. Embind dispatches on argument count only, and the two C++
  `norm` overload sets (`norm(src, normType, mask)` and `norm(src1, src2, normType, mask)`)
  collide at 2 and 3 arguments, so the generator kept only the first. `cv.norm(a, b)`
  passes the second Mat as an integer `normType` and fails at an assertion inside OpenCV.
- `mat.dftSplit()`: kept but deprecated. Its CCS unpacking convention was never verified
  independently, and its only 1.x consumer (the `mulSpectrums` that returned `NaN`) was
  broken. For complex spectrum multiplication use native `cv.mulSpectrums`, which works on
  CCS data directly.

---

## 6. Also note

- **`cv.sum` does not exist** (it is not whitelisted). `mat.sum()` is this project's
  method and returns **the scalar sum of all elements over all channels**, unlike OpenCV's
  `cv.sum()` (a per-channel Scalar).
- **The dnn bindings are removed**: `cv.readNetFromTensorflow` and friends are
  `undefined`. (The dnn C++ code is still in the artifact; the whitelist only controls
  which Embind bindings are generated.)
- **`cv.Scalar.all(v)` does not work**: the glue defines it as
  `cv.Scalar.all = function (v) { return Scalar(v, v, v, v); }` without `new`, so it throws
  `TypeError: this.push is not a function`. That is a bug in the glue's JS helpers
  (`Scalar` is not an Embind binding) and affects every opencv.js build. Use
  `new cv.Scalar(v, v, v, v)`.
