# opencvjs

![OpenCV 4.14.0](https://img.shields.io/badge/OpenCV-4.14.0-green.svg)
![WebAssembly](https://img.shields.io/badge/target-WebAssembly-blue.svg)

`opencv.js` plus a layer of extra `cv.Mat` convenience methods.
Baseline: **OpenCV 4.14.0, WebAssembly** (self-built — see [Build from source](#build-from-source)).

OpenCV upstream is actively maintained — 4.14.0 shipped on 2026-07-19. What upstream does _not_
ship is a standalone, production-oriented `opencv.js`: the official build is a reduced-function
tutorial build, bundled inside `opencv-{VERSION}-docs.zip` on each release and mirrored at
`docs.opencv.org/{VERSION}/opencv.js`. An OpenCV maintainer states it plainly in
[opencv#25425](https://github.com/opencv/opencv/issues/25425): _"Only reduced subset of functions
is provided here (size vs functionality compromise). Due to this there is no official OpenCV JS
release. We don't recommend to use that file directly in your projects."_

Up to 1.x this project shipped a 13.9 MB asm.js file derived from the official OpenCV 4.0.1
build, patched in place and never rebased. **2.0 builds the artifact from source** (Docker +
emsdk, pinned to `build/opencv-version.txt`) with its own export whitelist, and keeps the
extension layer as separate modules under `src/js/`.

## What changed in 2.0

- Artifact: asm.js / OpenCV 4.0.1 → **WebAssembly / OpenCV 4.14.0**, built by
  `build/build.sh` and verified in CI.
- Entry point is **async**: `const cv = await require("@haoking/opencvjs")()`.
- **Native OpenCV methods are no longer overridden.** `roi` / `col` / `diag` / `reshape` are
  back to their upstream behaviour; this project's fixed versions moved to `roiClone` /
  `colClone` / `diagClone` / `reshapeRows`.
- 8 hand-written methods deleted in favour of native equivalents (three of them were broken:
  `mds()` always threw, `mulSpectrums()` returned `NaN`).
- Full list with before/after code: **[`docs/MIGRATION-2.0.md`](docs/MIGRATION-2.0.md)**.

## Features

- [x] 20 extra `cv.Mat` methods plus `cv.norm2` on top of a stock OpenCV build — region copies,
      in-place writes, scalar arithmetic, and type-dispatching accessors (`DATA()` / `PTR()`)
- [x] Reproducible build from OpenCV source (Docker + emsdk, version pinned in
      `build/opencv-version.txt`); the export whitelist lives in `src/config/opencv_js.config.py`
      and additionally exposes `mulSpectrums` and `SVDecomp`, which the upstream tutorial build
      does not
- [x] **Arguments are checked before they reach wasm** (`src/js/guards.js`) — on every extension
      method **and on `PTR()` itself**: out-of-range rects and row/column indices, mismatched
      sizes/types, non-finite constants and already-`delete()`d Mats all raise a standard
      `TypeError` / `RangeError` naming the function, the argument, the value received and the
      range expected. Without that layer a bad `Rect` aborts inside C++ and emscripten rethrows it
      as a **bare number** (`throw 1914504` — not an `Error`, `e.message` is `undefined`), while a
      bad row/column index does not fail at all and silently writes past the end of the Mat
- [x] **TypeScript declarations generated from the artifact itself**, not hand-written:
      `dist/index.d.ts` dumps `Object.keys(cv)` and Mat's prototype chain, and a test asserts the
      declared symbol set equals the runtime one **in both directions**. The `.d.ts` files in the
      ecosystem declare `SIFT` / `PCA` / `FlannBasedMatcher`, which this build does not have, and
      omit `FaceDetectorYN`, which it does — so code type-checks and then throws at runtime
- [x] Zero runtime dependencies, zero test dependencies (`node:test` only)
- [x] `npm test` runs 189 assertions (188 pass / 1 skip / 0 fail, node v22.22.2): 84 region-op
      correctness cases across 7 depths × 4 channel counts × 3 APIs, 29 `clone()` deep-copy and
      copy-semantics cases, 21 regression cases for the defects 2.0 fixed, 48 argument-validation
      cases, 6 `.d.ts`-vs-runtime consistency cases, and 1 wasm-artifact smoke test that is
      skipped unless `OPENCV_ARTIFACT` is set
- [x] `npm run bench` gates region-op performance: `roiClone()` 14.6–14.8 ms vs the native
      `roi()` + `clone()` it wraps 13.7–14.3 ms (20000 iterations, 64×64 `CV_32FC1`,
      `Rect(1, 1, 32, 32)`, node v22.22.2 / darwin-arm64)

## Known Issues

- **`dftSplit()` 的正确性没有任何证据支撑**（已标 `@deprecated`，代码保留）。它把
  `cv.dft()` 的 CCS 紧凑输出拆成实部/虚部两个 Mat，但这个展开约定从未被独立验证过；
  1.x 时代它唯一的消费者是那个返回 `NaN` 的手写 `mulSpectrums()`，所以也不存在
  「端到端跑通过」这回事。需要复数谱相乘请直接用原生 `cv.mulSpectrums()`——它在 CCS
  格式上直接做乘法，根本不需要先拆分。
- **浏览器用法没有 1.x 那样的单文件形态。** 产物是 `opencv.js`（约 143 KB 的 glue）
  - `opencv_js.wasm`（约 8.5 MB）两个文件，必须同目录同名；扩展层是 CommonJS 模块，
    `<script>` 直接引 `dist/opencv.js` 只能拿到原生 OpenCV，要用扩展层得走打包器。
    本仓库的测试只覆盖 Node（CI 矩阵 18 / 20 / 22），浏览器路径未做验证。

## Requirements

- Node.js >= 18（CI 覆盖 18 / 20 / 22）
- 从源码构建产物还需要 Docker（`build/build.sh` 在 emsdk 容器里跑，宿主机不需要工具链）

## Communication

- If you **found a bug**, open an issue.
- If you **have a feature request**, open an issue.
- If you **want to contribute**, submit a pull request.

## Installation

```bash
npm install @haoking/opencvjs
```

```javascript
const loadCV = require("@haoking/opencvjs");

(async () => {
  const cv = await loadCV();
  const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  console.log("mat::" + mat.data32F); //mat::1,2,3,4,5,6,7,8,9
  mat.delete(); //Don't forget to delete cv.Mat when you don't want to use it any more.
})();
```

> ⚠️ **就绪判据只能看 `typeof cv.Mat === "function"`。**
> `await` 之后 `cv.onRuntimeInitialized` 这个属性**依然存在**（实测 `typeof` 为
> `function`）。拿它判断「还没就绪」会恒真，于是去等一个永不再触发的回调——
> 本项目第一次 CI 冒烟测试就是这么挂掉的。

包里的 `dist/` 是扁平布局：`index.js`（入口）、`opencv.js`（emscripten glue）、
`opencv_js.wasm`，以及五个扩展模块和 `index.d.ts`。glue 在 Node 下按 `__dirname`
定位 `.wasm`，所以三者必须留在同一个目录里，文件名也不能改。

### TypeScript

`package.json` 的 `types` 指向 `dist/index.d.ts`，装完即可用，不需要
`@types/*`：

```typescript
import loadOpenCV = require("@haoking/opencvjs");

const cv = await loadOpenCV();
const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const roi = mat.roiClone(new cv.Rect(1, 1, 2, 2)); // roi: Mat
const data: Float32Array = roi.data32F;
(mat.delete(), roi.delete());
```

这份声明**由构建产物自动 dump**（`build/gen-types.js`，组装时执行），不是手写的：
顶层符号来自运行时的 `Object.keys(cv)`，Mat 成员来自其整条原型链，
`test/types/dts-consistency.test.js` 双向断言两个集合严格相等。

> ℹ️ **为什么要这么做**：生态里现有的 OpenCV.js 声明（`@opencvjs/types`、TechStark 的
> `src/`）与运行时不符——声明了运行时没有的 `SIFT` / `PCA` / `FlannBasedMatcher`，
> 又漏掉了确实存在的 `FaceDetectorYN`。血统能追到 2019 年的 mirada，此后靠人手维护。
> 后果是最难受的那种：**代码通过类型检查，然后运行时抛异常。**

范围与限制：

- **保证**符号存在性与运行时严格一致（1450 个顶层符号、75 个 Mat 成员，实测）。
- **不保证**每个原生函数的参数类型精确——那需要解析 OpenCV 的 C++ 签名并复现 embind
  的重载分发规则，超出本项目范围。未逐条标注的原生绑定一律是 `(...args: any[]): any`。
  本项目自己写的扩展层（`roiClone` / `DATA` / `PTR` / `replaceMatOn*` 等）有准确签名。
- **没有 `Symbol.dispose`**，所以用不了 TS 5.2 的 `using`（实测本产物的 Mat 原型链上
  没有任何 symbol 属性）。Mat 一律由调用方显式 `delete()`。

### Build from source

产物不入 git。本地要跑测试或自己出包：

```bash
./build/build.sh          # Docker + emsdk 构建 OpenCV → build/out/baseline/
npm run assemble          # build/out/baseline + src/js/ → dist/（含 index.d.ts）
npm test                  # 189 项
npm run bench             # 性能门禁
```

`npm run assemble` 也接受一个目录参数（例如 CI 下载下来的产物目录）：
`npm run assemble -- /path/to/artifact`。

CI 里 `build-wasm.yml` 负责构建并上传产物，`ci.yml` 取它最近一次成功运行的产物再组装。

---

## Usage

下面所有示例都假定 `cv` 已经拿到：

```javascript
const cv = await require("@haoking/opencvjs")();
```

示例里注释掉的输出值都是在 2.0 的产物上实际跑出来的（node v22.22.2）。

### Argument validation

本项目的每个扩展方法都会在**调用 wasm 之前**校验参数，失败时抛标准
`TypeError` / `RangeError`，消息里带上函数名、参数名、实际收到的值和期望的范围：

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
try {
  mat1.roiClone(new cv.Rect(1, 1, 10, 10));
} catch (e) {
  console.log(e instanceof RangeError); //true
  console.log(e.message);
  //Mat.roiClone(rect): Rect(x=1, y=1, width=10, height=10) 超出 3×3（行×列）的 Mat —— 要求 0 ≤ x 且 x+width ≤ cols=3，0 ≤ y 且 y+height ≤ rows=3
}
mat1.delete();
```

其余几条的实际消息（同样逐字实测）：

```text
Mat.addOnCol(constant, col): col = 7 越界，有效范围 0..2

cv.matFromArray(rows, cols, type, array): CV_32FC1(5) 的 3×3 Mat 需要 9 个元素
（3×3×1 通道），实际收到 3 个 —— 元素不足时 TypedArray.set() 不报错，Mat 剩余
部分是未初始化的堆内存

cv.norm2(src1, src2, normType): src1 是 CV_32FC1(5)，src2 是 CV_8UC1(0)
—— 两者类型必须一致

Mat.sum(): 接收者 Mat 已被 delete() —— 释放后的 Mat 不能再使用
```

这层校验解决的是两类都很难查的故障：

1. **abort 抛出的不是 `Error` 实例。** 本产物在异常被编译掉的配置下构建，C++ 侧的
   `CV_Assert` 失败会走 abort，emscripten 把它转成 `throw <裸数字>`——实测
   `mat.roi(new cv.Rect(1, 1, 10, 10))` 抛出 `1914504`。`e instanceof Error` 是 `false`、
   `e.message` 是 `undefined`，调用方想「记条日志再降级」都会让自己再崩一次，而那个
   数字对定位问题毫无帮助。（模块本身在 abort 之后仍可继续使用。）
2. **越界的行列号根本不会 abort。** embind 生成的 `*Ptr(row, col)` 不做边界检查：
   3×3 `CV_32FC1`（共 36 字节）上 `mat.PTR(9, 9)` 返回 base+144 字节处的
   `Float32Array`，读写都落在别人的堆上，不报任何错。`replaceMatOnRect` /
   `rectAdd` / `rectSubtract` / `replaceMatOnCol` / `addOnCol` / `replaceMatOnPoint` /
   `replaceMatOnRow` 全都由 `PTR()` 逐像素驱动，所以一个越界的 `Rect` 或列号就是一次
   静默的堆破坏。这类比第 1 类危险得多。

`PTR()` 自己也查边界（它是公开 API，用户会绕开上面那些方法直接调）：

```javascript
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
try {
  mat2.PTR(9, 9);
} catch (e) {
  console.log(e.message);
  //Mat.PTR(row, col): row = 9 越界，有效范围 0..2
}
mat2.delete();
```

> ⚠️ **每个下标只校验一次。** `rows` / `cols` 是 embind getter，每读一次都是一次跨
> 语言调用——给 `PTR()` 加边界检查实测让它慢 49%（+23.7 ns/次）。所以扩展层内部
> 那些逐像素的循环**不走 `PTR()`**：它们在入口用一次校验证明整个循环的下标范围
> 合法，循环里直接用原生访问器。不这么分工的话 `replaceMatOnRect` 会慢 82%
> （同进程轮换 6 轮、丢首轮、取最小值实测）。
>
> `DATA()` 不收参数，没有可越界的入参。

### Commonly

**add()**

void cv.add(src1, src2, dst)

( dst = src1 + src2 )

src1 First input mat

src2 Second input mat

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = new cv.Mat();
cv.add(mat1, mat2, dst);
(mat1.delete(), mat2.delete());
//Don't forget to delete cv.Mat when you don't want to use it any more.
console.log("dst::" + dst.data32F); //dst::2,4,6,8,10,12,14,16,18
```

**addConstant()**

cv.Mat dst = src1.addConstant(constant)

( dst = src1 + constant )

src1 First input mat

constant Constant added to each element.

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.addConstant(10);
mat1.delete();
console.log("dst::" + dst.data32F); //dst::11,12,13,14,15,16,17,18,19
```

**subtract()**

void cv.subtract(src1, src2, dst)

( dst = src1 - src2 )

src1 First input mat

src2 Second input mat

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = new cv.Mat();
cv.subtract(mat1, mat2, dst);
(mat1.delete(), mat2.delete());
console.log("dst::" + dst.data32F); //dst::0,0,0,0,0,0,0,0,0
```

**constantSubtract()**

cv.Mat dst = src1.constantSubtract(constant)

( dst = constant - src1 )

constant Constant subtract each element.

src1 First input mat

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.constantSubtract(10);
mat1.delete();
console.log("dst::" + dst.data32F); //dst::9,8,7,6,5,4,3,2,1
```

**~~mmul()~~ → cv.gemm()**

> 🔀 **2.0 起 `mat.mmul(b)` 已删除**，改用原生 `cv.gemm(src1, src2, alpha, src3, beta, dst, flags)`。
> `beta = 0` 时 `src3` 不参与计算，传一个空 Mat 即可。

```javascript
let mat1 = cv.matFromArray(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]);
let mat2 = cv.matFromArray(3, 2, cv.CV_32FC1, [7, 8, 9, 10, 11, 12]);
let noop = new cv.Mat();
let dst = new cv.Mat();
cv.gemm(mat1, mat2, 1, noop, 0, dst, 0);
(mat1.delete(), mat2.delete(), noop.delete());
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::58,64,139,154:::2:::2
```

**mul()**

cv.Mat dst = src1.mul(src2, scale)

( dst = src1 • src2\*scale ) —— 逐元素乘，OpenCV 原生方法。

src1 First input mat

src2 Second input mat

scale Optional scale factor.

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.mul(mat2, 2);
(mat1.delete(), mat2.delete());
console.log("dst::" + dst.data32F); //dst::2,8,18,32,50,72,98,128,162
```

**mulConstant()**

cv.Mat dst = src1.mulConstant(constant)

( dst = src1 \* constant )

src1 First input mat

constant Constant multiplied with each element.

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.mulConstant(10);
mat1.delete();
console.log("dst::" + dst.data32F); //dst::10,20,30,40,50,60,70,80,90
```

**divide()**

void cv.divide(src1, src2, dst)

( dst = src1 / src2 )

src1 First input mat

src2 Second input mat

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = new cv.Mat();
cv.divide(mat1, mat2, dst);
(mat1.delete(), mat2.delete());
console.log("dst::" + dst.data32F); //dst::1,1,1,1,1,1,1,1,1
```

**constantDivide()**

cv.Mat dst = src1.constantDivide(constant)

( dst = constant / src1 )

constant Constant divided by each element.

src1 First input mat

dst Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.constantDivide(10);
mat1.delete();
console.log("dst::" + dst.data32F);
//dst::10,5,3.3333332538604736,2.5,2,1.6666666269302368,1.4285714626312256,1.25,1.1111111640930176
```

> ✅ **2.0 修复**：1.x 在多通道 Mat 上把通道 1+ 除以 0（被除数用 `new cv.Scalar(c)`
> 填充，而 Scalar 缺省分量是 0——实测填 `CV_32FC3` 得 `16,0,0,16,0,0`）。

```javascript
let mat3 = new cv.Mat(1, 2, cv.CV_32FC3, new cv.Scalar(2, 2, 2, 2));
console.log("dst::" + mat3.constantDivide(16).data32F); //dst::8,8,8,8,8,8
```

**reshapeRows()** （1.x 名为 `reshape()`）

cv.Mat dst = src1.reshapeRows(rows)

src1 First input mat

rows Reshape to rows

dst **A new copy** whose data equals src1's, laid out with the requested row count

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.reshapeRows(1);
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,4,5,6,7,8,9:::1:::9
mat1.reshapeRows(4);
//RangeError: reshapeRows(4)：3×3 的 9 个像素无法整除为 4 行
mat1.delete();
dst.delete();
```

> 🔀 **改名理由与其它几个不同**：这个产物的 embind 绑定里**根本没有** `Mat::reshape`
> （实测 `typeof cv.Mat.prototype.reshape === "undefined"`），1.x 并没有覆盖任何东西。
> 改名是为腾出这个名字，同时把语义差异摆明——OpenCV 原生的 `reshape()` 返回共享内存的
> 新 header，这里返回的是**副本**。整除校验是 2.0 新加的（1.x 静默产出错误形状）。

**sum()**

Number dst = src1.sum()

src1 First input mat

dst 所有元素（含各通道）的标量和

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
console.log("sum::" + mat1.sum()); //sum::45
mat1.delete();

let mat2 = cv.matFromArray(
  2,
  2,
  cv.CV_32FC3,
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
);
console.log("sum::" + mat2.sum()); //sum::78
mat2.delete();
```

> ℹ️ 与 OpenCV 的 `cv.sum()` 语义不同——后者返回逐通道的 Scalar，且**不在本产物的
> 白名单里**（实测 `typeof cv.sum === "undefined"`）。

**norm()**

Number dst = cv.norm(src1)

src1 First input mat

dst Norm of src1

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = cv.norm(mat1);
mat1.delete();
console.log("dst::" + dst); //dst::16.881943016134134
```

**norm2()**

Number dst = cv.norm2(src1, src2, normType = cv.NORM_L2)

src1 First input mat

src2 Second input mat

dst ‖src1 − src2‖

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
// prettier-ignore
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
let dst2 = cv.norm2(mat1, mat2);
(mat1.delete(), mat2.delete());
console.log("dst2::" + dst2); //dst2::24
```

> ℹ️ **不要改用原生 `cv.norm(a, b, normType)`——这个产物里没有那个重载。**
> embind 只按参数个数分发，而 C++ 的两组 `norm` 重载（`norm(src, normType, mask)` 与
> `norm(src1, src2, normType, mask)`）在 2 参和 3 参上撞车，绑定生成器只保留了前一组。
> 实测 `cv.norm(a, b, cv.NORM_L2)` 抛 `BindingError: Cannot pass "4" as a Mat`；更糟的是
> `cv.norm(a, b)` **不报类型错**，而是把 Mat 的 wire 指针当整数 `normType` 传进 C++，
> 到 OpenCV 内部的断言处才炸。

**diagClone()** （1.x 名为 `Diag()`）

cv.Mat dst = src1.diagClone(d = 0)

src1 First input mat

d Index of the diagonal

dst **A continuous copy** of the diagonal

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.diagClone();
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,5,9:::3:::1
```

> 🔀 OpenCV 原生的 `mat.diag(d)` 仍然可用，返回的是**视图**（非连续，读它的 `.data*`
> 会得到错误数据；但写它会写回源 Mat）。2.0 不再覆盖它。

**~~vconcat()~~ / ~~hconcat()~~ → cv.vconcat() / cv.hconcat()**

> 🔀 **2.0 起 `mat.vconcat(b)` / `mat.hconcat(b)` 已删除**，改用原生同名函数，
> 参数由 Mat 变成 MatVector。

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let vec = new cv.MatVector();
vec.push_back(mat1);
vec.push_back(mat1);

let dstV = new cv.Mat();
cv.vconcat(vec, dstV);
console.log("dstV::" + dstV.data32F + ":::" + dstV.rows + ":::" + dstV.cols);
//dstV::1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9:::6:::3

let dstH = new cv.Mat();
cv.hconcat(vec, dstH);
console.log("dstH::" + dstH.data32F + ":::" + dstH.rows + ":::" + dstH.cols);
//dstH::1,2,3,1,2,3,4,5,6,4,5,6,7,8,9,7,8,9:::3:::6

(mat1.delete(), vec.delete());
```

**row()**

cv.Mat dst = src1.row(row) —— OpenCV 原生方法，返回**视图**。

src1 First input mat

row Index of the rows

dst Output mat that has one row

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.row(2);
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::7,8,9:::1:::3
(mat1.delete(), dst.delete());
```

> ℹ️ 单独一行本来就是连续的（实测 `isContinuous() === true`），所以直读 `.data*` 没问题。
> 列和矩形区域不是，见下面的 `colClone()` / `roiClone()`。

**colClone()** （1.x 名为 `col()`）

cv.Mat dst = src1.colClone(col)

src1 First input mat

col Index of the cols

dst **A continuous copy** of that column

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
console.log("colClone::" + mat1.colClone(2).data32F); //colClone::3,6,9
console.log("col::" + mat1.col(2).data32F); //col::3,4,5   ← 原生视图，非连续，直读是错的
mat1.delete();
```

多通道上差得更远（3×3 `CV_32FC2`，值 1..18）：

```javascript
// prettier-ignore
let mat2 = cv.matFromArray(3, 3, cv.CV_32FC2,
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
console.log("colClone::" + mat2.colClone(2).data32F); //colClone::5,6,11,12,17,18
console.log("col::" + mat2.col(2).data32F); //col::5,6,7,8,9,10   ← 错的
mat2.delete();
```

> 🔀 **2.0 不再覆盖原生 `col()`。** 要读数据用 `colClone()`，要写回源 Mat 用原生
> `col()`（视图）。

**roiClone()** （1.x 名为 `roi()`）

cv.Mat dst = src1.roiClone(rect)

src1 First input mat

rect a rect

dst **A continuous copy** of that sub-rectangle

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let dst = mat1.roiClone(rect1);
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::5,6,8,9:::2:::2

// 原生 roi() 仍是视图：写它会写回源 Mat
let view = mat1.roi(rect1);
view.setTo(new cv.Scalar(0, 0, 0, 0));
console.log("mat1::" + mat1.data32F); //mat1::1,2,3,4,0,0,7,0,0

(mat1.delete(), dst.delete(), view.delete());
```

> ℹ️ **副本是有代价的**：256×256 `CV_32FC2` 上取 `Rect(0, 0, 128, 128)`、5000 次，
> 原生视图 1.2–1.9 ms vs `roiClone()` 20.8–23.3 ms（node v22.22.2 / darwin-arm64，
> 3 次独立测量各取第 2–4 轮）。只需要写回源 Mat 时别用 `*Clone`。

**replaceMatOnRect()**

void src1.replaceMatOnRect(src2, rect)

src1 First input mat will be changed as output

src2 Second input mat as rect mat

rect rect input to replace

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2, 2, cv.CV_32FC1, [11, 12, 13, 14]);
mat1.replaceMatOnRect(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**replaceMatOnRow()**

void src1.replaceMatOnRow(arr, row)

src1 First input mat will be changed as output

arr Second input Array as row array

row row input to replace

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
mat1.replaceMatOnRow([11, 12, 13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,11,12,13,7,8,9:::3:::3
```

> ✅ **2.0 修复**：1.x 硬编码 `this.floatPtr(d)`，在非 `CV_32F` 的 Mat 上**静默写坏内存
> 并越界**（embind 的 `floatPtr` 不做类型校验：`CV_8UC1` 的 2×3 Mat 只有 6 字节，
> `floatPtr(0)` 却返回长度 3 的 `Float32Array`，即 12 字节）。实测 1.x 在该 Mat 上把
> 数据改成 `0,0,32,65,0,0`。2.0 改走 `PTR()`，七种深度实测全部得到 `10,20,30,4,5,6`。

**replaceMatOnCol()**

void src1.replaceMatOnCol(arr, col)

src1 First input mat will be changed as output

arr Second input Array as col array

col col input to replace

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
mat1.replaceMatOnCol([11, 12, 13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**replaceMatOnPoint()**

void src1.replaceMatOnPoint(value, row, col)

void src1.replaceMatOnPoint(value, point) —— `cv.Point` 约定 x = 列、y = 行

src1 First input mat will be changed as output

value The value to write

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
mat1.replaceMatOnPoint(30, 1, 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,30,6,7,8,9:::3:::3

let mat2 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
mat2.replaceMatOnPoint(30, new cv.Point(2, 0)); // x=2 列、y=0 行
console.log("mat2::" + mat2.data32F); //mat2::1,2,30,4,5,6,7,8,9

mat2.replaceMatOnPoint(1, 0);
//TypeError: replaceMatOnPoint(value, row, col) 或 replaceMatOnPoint(value, point)：缺少 col
```

> ✅ **2.0 修复**：1.x 的形参名是 `(constant, x, y)` 而实现是 `PTR(x, y)`——`x` 其实是
> 行号；文档里记的 `(value, point)` 重载则根本不存在（传对象抛
> `TypeError: Cannot convert "[object Object]" to int`）。
> **位置参数的行为与 1.x 逐字相同**（第 2 个参数一直是行、第 3 个一直是列），
> 已经在跑的三参调用不用改。

**addOnCol()**

void src1.addOnCol(constant, col)

src1 First input mat will be changed as output

constant Constant added to each element of that column

col Col location

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
mat1.addOnCol(30, 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,32,3,4,35,6,7,38,9:::3:::3
```

**rectAdd()**

void src1.rectAdd(src2, rect)

src1 First input mat will be changed as output

src2 Second input mat as rect mat

rect rect input to add location

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2, 2, cv.CV_32FC1, [11, 12, 13, 14]);
mat1.rectAdd(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,16,18,7,21,23:::3:::3
```

**rectSubtract()**

void src1.rectSubtract(src2, rect)

src1 First input mat will be changed as output

src2 Second input mat as rect mat

rect rect input to subtract location

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2, 2, cv.CV_32FC1, [11, 12, 13, 14]);
mat1.rectSubtract(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,-6,-6,7,-5,-5:::3:::3
```

**DATA() / PTR()**

TypedArray dst = src1.DATA() —— 覆盖整个 Mat，按元素类型定型

TypedArray dst = src1.PTR(row) —— 第 row 行的全部元素（cols × channels 个）

TypedArray dst = src1.PTR(row, col) —— 该像素的各通道（channels 个）

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_8UC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
console.log("DATA::" + mat1.DATA()); //DATA::1,2,3,4,5,6,7,8,9
console.log("PTR(1)::" + mat1.PTR(1)); //PTR(1)::4,5,6
console.log("PTR(1,2)::" + mat1.PTR(1, 2)); //PTR(1,2)::6
mat1.delete();
```

按 `depth()` 分发到对应的 `data*` / `*Ptr`，省掉调用方自己挑访问器（挑错不报错、
结果全错）。⚠️ `DATA()` 只对连续 Mat 有意义——原生 `roi()`/`col()`/`diag()` 返回的
视图上它会按连续内存直读，得到错误数据。

**~~mds()~~ → cv.meanStdDev()**

> 🔀 **2.0 起 `mat.mds()` 已删除。** 1.x 版本 100% 抛
> `TypeError: src1Array.reduce is not a function`（实现里写的是 `this.DATA` 而非
> `this.DATA()`，取到的是函数对象），不存在「以前能用」这回事。

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let mean = new cv.Mat();
let stddev = new cv.Mat();
cv.meanStdDev(mat1, mean, stddev);
console.log("mean::" + mean.data64F[0] + " stddev::" + stddev.data64F[0]);
//mean::5 stddev::2.5819888974716108
(mat1.delete(), mean.delete(), stddev.delete());
```

**~~svd()~~ → cv.SVDecomp()**

> 🔀 **2.0 起 `mat.svd()` 已删除。** 1.x 走的是当年内联进产物的 numeric.js 库；
> 那份库随 2.0 一起删掉，改用原生 `cv.SVDecomp(src, w, u, vt, flags)`。
> （注意：只有函数式的 `SVDecomp`，`cv.SVD` 这个类不在白名单里。）

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let w = new cv.Mat();
let u = new cv.Mat();
let vt = new cv.Mat();
cv.SVDecomp(mat1, w, u, vt, 0);
console.log("w::" + w.data32F);
//w::16.848102569580078,1.0683696269989014,1.1560786106201704e-8
(mat1.delete(), w.delete(), u.delete(), vt.delete());
```

奇异值与 1.x 的 `numeric.svd` 一致；第三个是 0——`[[1,2,3],[4,5,6],[7,8,9]]` 秩为 2。

**~~RodriguesFromArray()~~ / ~~RodriguesFromMat()~~ → cv.Rodrigues()**

> 🔀 **2.0 起两者都已删除**，改用原生 `cv.Rodrigues(src, dst)`——双向都走同一个函数，
> 按输入形状自动判断方向。

```javascript
let rvec = cv.matFromArray(3, 1, cv.CV_32FC1, [0.1, 0.2, 0.3]);
let R = new cv.Mat();
cv.Rodrigues(rvec, R); // 3×3 旋转矩阵

let back = new cv.Mat();
cv.Rodrigues(R, back);
console.log("back::" + back.data32F);
//back::0.10000000149011612,0.20000000298023224,0.30000004172325134
(rvec.delete(), R.delete(), back.delete());
```

**dftSplit()**

> ⚠️ **`@deprecated`——正确性没有任何证据支撑，请勿在新代码里使用。**
> 它的 CCS 展开约定从未被独立验证过；1.x 时代唯一的消费者是那个返回 `NaN` 的手写
> `mulSpectrums()`，所以也不存在端到端参照。需要复数谱相乘请直接用原生
> `cv.mulSpectrums()`。保留只是因为它属于 1.x 的公开 API。

{r: cv.Mat, i: cv.Mat} dst = src1.dftSplit()

```javascript
let mat1 = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
let dst = mat1.dftSplit();
console.log("dst::" + dst.r.data32F + ":::" + dst.i.data32F);
//dst::1,3,0,4,6,0,0,8,0:::0,3,0,7,9,0,0,9,0
(mat1.delete(), dst.r.delete(), dst.i.delete());
```

**mulSpectrums()** （原生；取代 1.x 的 `cv.mulSpectrums` 与 `cv.mulSpectrums2Channel`）

> 🔀 **签名变了**：`cv.mulSpectrums(src1, src2, dst, flags, conjB)`。
> 1.x 的两个手写版都返回无效结果——部分元素恒为 `NaN`，另一部分每次运行都不同
> （读到了未初始化的堆内存）。2.0 在构建白名单里放行了原生 `mulSpectrums`。

```javascript
// CCS 紧凑格式：cv.dft() 不带 DFT_COMPLEX_OUTPUT 时的单通道输出
let mat1 = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
let mat2 = cv.matFromArray(1, 4, cv.CV_32FC1, [5, 6, 7, 8]);
let dst = new cv.Mat();
cv.mulSpectrums(mat1, mat2, dst, 0, false);
console.log("dst::" + dst.data32F); //dst::5,-9,32,32

// 双通道复数格式（取代 mulSpectrums2Channel）
let c1 = cv.matFromArray(1, 2, cv.CV_32FC2, [1, 2, 3, 4]); // 1+2i, 3+4i
let c2 = cv.matFromArray(1, 2, cv.CV_32FC2, [5, 6, 7, 8]); // 5+6i, 7+8i
let dst2 = new cv.Mat();
cv.mulSpectrums(c1, c2, dst2, 0, false);
console.log("dst2::" + dst2.data32F + ":::channels=" + dst2.channels());
//dst2::-7,16,-11,52:::channels=2      ← (1+2i)(5+6i) = -7+16i, (3+4i)(7+8i) = -11+52i

cv.mulSpectrums(c1, c2, dst2, 0, true);
console.log("dst2::" + dst2.data32F); //dst2::17,4,53,4      ← conjB
```

原生版返回的 `channels()` 与输入一致（1.x 手写版对 `CV_32FC2` 输入返回 `channels() === 1`）。

##

### Others

**default constructor**

```javascript
let mat = new cv.Mat();
let mat = new cv.Mat(size, type);
let mat = new cv.Mat(rows, cols, type);
let mat = new cv.Mat(rows, cols, type, new cv.Scalar());
let mat = cv.matFromArray(rows, cols, type, array);

let ctx = canvas.getContext("2d");
let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
let mat = cv.matFromImageData(imgData);

let mat = cv.Mat.zeros(rows, cols, type);
let mat = cv.Mat.ones(rows, cols, type);
let mat = cv.Mat.eye(rows, cols, type);
```

**copy Mat**

```javascript
let dst = src.clone();
src.copyTo(dst, mask);
```

**convert type**

```javascript
src.convertTo(m, rtype, (alpha = 1), (beta = 0));
```

**MatVector**

```javascript
let mat = new cv.Mat();
let matVec = new cv.MatVector();
matVec.push_back(mat);
let cnt = matVec.get(0);
mat.delete();
matVec.delete();
cnt.delete();
```

**data**

```javascript
[Data Properties]	[C++ Type]	[JavaScript Typed Array]	[Mat Type]
data				uchar		Uint8Array					CV_8U
data8S				char		Int8Array					CV_8S
data16U				ushort		Uint16Array					CV_16U
data16S				short		Int16Array					CV_16S
data32S				int			Int32Array					CV_32S
data32F				float		Float32Array				CV_32F
data64F				double		Float64Array				CV_64F

// row = 3, col = 4, channels = 4
let R = src.data[row * src.cols * src.channels() + col * src.channels()];
let G = src.data[row * src.cols * src.channels() + col * src.channels() + 1];
let B = src.data[row * src.cols * src.channels() + col * src.channels() + 2];
let A = src.data[row * src.cols * src.channels() + col * src.channels() + 3];
```

**at**

```javascript
[Mat Type]		[At Manipulation]
CV_8U			ucharAt
CV_8S			charAt
CV_16U			ushortAt
CV_16S			shortAt
CV_32S			intAt
CV_32F			floatAt
CV_64F			doubleAt

//row = 3, col = 4, channels = 4
let R = src.ucharAt(row, col * src.channels());
let G = src.ucharAt(row, col * src.channels() + 1);
let B = src.ucharAt(row, col * src.channels() + 2);
let A = src.ucharAt(row, col * src.channels() + 3);
```

**ptr**

```javascript
[Mat Type]		[Ptr Manipulation]		[JavaScript Typed Array]
CV_8U			ucharPtr				Uint8Array
CV_8S			charPtr					Int8Array
CV_16U			ushortPtr				Uint16Array
CV_16S			shortPtr				Int16Array
CV_32S			intPtr					Int32Array
CV_32F			floatPtr				Float32Array
CV_64F			doublePtr				Float64Array

//row = 3, col = 4, channels = 4
let pixel = src.ucharPtr(row, col);
let R = pixel[0];
let G = pixel[1];
let B = pixel[2];
let A = pixel[3];
```

**Bitwise Operations**

```javascript
cv.bitwise_not();
cv.bitwise_and();
cv.bitwise_or();
cv.bitwise_xor();
```

**Point**

```javascript
let point = new cv.Point(x, y);
let point = { x: x, y: y };
```

**Scalar**

```javascript
let scalar = new cv.Scalar(R, G, B, Alpha);
let scalar = [R, G, B, Alpha];
```

**Size**

```javascript
let size = new cv.Size(width, height);
let size = { width: width, height: height };
```

**Circle**

```javascript
let circle = new cv.Circle(center, radius);
let circle = { center: center, radius: radius };
```

**Rect**

```javascript
let rect = new cv.Rect(x, y, width, height);
let rect = { x: x, y: y, width: width, height: height };
```

**RotatedRect**

```javascript
let rotatedRect = new cv.RotatedRect(center, size, angle);
let rotatedRect = { center: center, size: size, angle: angle };

let vertices = cv.RotatedRect.points(rotatedRect);
let point1 = vertices[0];
let point2 = vertices[1];
let point3 = vertices[2];
let point4 = vertices[3];

let boundingRect = cv.RotatedRect.boundingRect(rotatedRect);
```

**cvtColor**

```javascript
cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);
```

**inRange**

```javascript
cv.inRange(src, low, high, dst);
```

**Scaling**

```javascript
cv.resize(
  src,
  dst,
  dsize,
  (fx = 0),
  (fy = 0),
  (interpolation = cv.INTER_LINEAR),
);
```

**Translation**

```javascript
cv.warpAffine(
  src,
  dst,
  M,
  dsize,
  (flags = cv.INTER_LINEAR),
  (borderMode = cv.BORDER_CONSTANT),
  (borderValue = new cv.Scalar()),
);
```

**Rotation**

```javascript
cv.getRotationMatrix2D(center, angle, scale);
```

**Affine Transformation**

```javascript
cv.getAffineTransform(src, dst);
```

**Perspective Transformation**

```javascript
let M = cv.getPerspectiveTransform(srcTri, dstTri);
cv.warpPerspective(
  src,
  dst,
  M,
  dsize,
  cv.INTER_LINEAR,
  cv.BORDER_CONSTANT,
  new cv.Scalar(),
);
```

**Simple Thresholding**

```javascript
cv.threshold(src, dst, 177, 200, cv.THRESH_BINARY);
```

**Adaptive Thresholding**

```javascript
//cv.adaptiveThreshold (src, dst, maxValue, adaptiveMethod, thresholdType, blockSize, C)
cv.adaptiveThreshold(
  src,
  dst,
  200,
  cv.ADAPTIVE_THRESH_GAUSSIAN_C,
  cv.THRESH_BINARY,
  3,
  2,
);
```

**2D Convolution ( Image Filtering )**

```javascript
//cv.filter2D (src, dst, ddepth, kernel, anchor = new cv.Point(-1, -1), delta = 0, borderType = cv.BORDER_DEFAULT)
cv.filter2D(src, dst, cv.CV_8U, M, anchor, 0, cv.BORDER_DEFAULT);
```

**Image Blurring (Image Smoothing)**

```javascript
//cv.blur (src, dst, ksize, anchor = new cv.Point(-1, -1), borderType = cv.BORDER_DEFAULT)
cv.blur(src, dst, ksize, anchor, cv.BORDER_DEFAULT);

//cv.boxFilter (src, dst, ddepth, ksize, anchor = new cv.Point(-1, -1), normalize = true, borderType = cv.BORDER_DEFAULT)
cv.boxFilter(src, dst, -1, ksize, anchor, true, cv.BORDER_DEFAULT);

//cv.GaussianBlur (src, dst, ksize, sigmaX, sigmaY = 0, borderType = cv.BORDER_DEFAULT)
cv.GaussianBlur(src, dst, ksize, 0, 0, cv.BORDER_DEFAULT);

//cv.medianBlur (src, dst, ksize)
cv.medianBlur(src, dst, 5);

//cv.bilateralFilter (src, dst, d, sigmaColor, sigmaSpace, borderType = cv.BORDER_DEFAULT)
cv.bilateralFilter(src, dst, 9, 75, 75, cv.BORDER_DEFAULT);
```

**Erosion**

```javascript
//cv.erode (src, dst, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.erode(
  src,
  dst,
  M,
  anchor,
  1,
  cv.BORDER_CONSTANT,
  cv.morphologyDefaultBorderValue(),
);
```

**Dilation**

```javascript
//cv.dilate (src, dst, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.dilate(
  src,
  dst,
  M,
  anchor,
  1,
  cv.BORDER_CONSTANT,
  cv.morphologyDefaultBorderValue(),
);
```

**Opening**

```javascript
//cv.morphologyEx (src, dst, op, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.morphologyEx(
  src,
  dst,
  cv.MORPH_OPEN,
  M,
  anchor,
  1,
  cv.BORDER_CONSTANT,
  cv.morphologyDefaultBorderValue(),
);
```

**Closing**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_CLOSE, M);
```

**Morphological Gradient**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_GRADIENT, M);
```

**Top Hat**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_TOPHAT, M);
```

**Black Hat**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_BLACKHAT, M);
```

**Structuring Element**

```javascript
//cv.getStructuringElement (shape, ksize, anchor = new cv.Point(-1, -1))
M = cv.getStructuringElement(cv.MORPH_CROSS, ksize);
cv.morphologyEx(src, dst, cv.MORPH_GRADIENT, M);
```

**Sobel and Scharr Derivatives**

```javascript
//cv.Sobel (src, dst, ddepth, dx, dy, ksize = 3, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Sobel(src, dstx, cv.CV_8U, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);

//cv.Scharr (src, dst, ddepth, dx, dy, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Scharr(src, dstx, cv.CV_8U, 1, 0, 1, 0, cv.BORDER_DEFAULT);
```

**Laplacian Derivatives**

```javascript
//cv.Laplacian (src, dst, ddepth, ksize = 1, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Laplacian(src, dst, cv.CV_8U, 1, 1, 0, cv.BORDER_DEFAULT);
```

**Image AbsSobel**

```javascript
cv.Sobel(src, dstx, cv.CV_8U, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
cv.Sobel(src, absDstx, cv.CV_64F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
cv.convertScaleAbs(absDstx, absDstx, 1, 0);
```

**draw the contours**

```javascript
//cv.findContours (image, contours, hierarchy, mode, method, offset = new cv.Point(0, 0))
cv.findContours(
  src,
  contours,
  hierarchy,
  cv.RETR_CCOMP,
  cv.CHAIN_APPROX_SIMPLE,
);

//cv.drawContours (image, contours, contourIdx, color, thickness = 1, lineType = cv.LINE_8, hierarchy = new cv.Mat(), maxLevel = INT_MAX, offset = new cv.Point(0, 0))
cv.drawContours(dst, contours, i, color, 1, cv.LINE_8, hierarchy, 100);
```

**Moments**

```javascript
//cv.moments (array, binaryImage = false)
let Moments = cv.moments(cnt, false);
```

**Contour Area**

```javascript
//cv.contourArea (contour, oriented = false)
let area = cv.contourArea(cnt, false);
```

**Contour Perimeter**

```javascript
//cv.arcLength (curve, closed)
let perimeter = cv.arcLength(cnt, true);
```

**Contour Approximation**

```javascript
//cv.approxPolyDP (curve, approxCurve, epsilon, closed)
cv.approxPolyDP(cnt, tmp, 3, true);
```

**Convex Hull**

```javascript
//cv.convexHull (points, hull, clockwise = false, returnPoints = true)
cv.convexHull(cnt, tmp, false, true);
```

**Checking Convexity**

```javascript
cv.isContourConvex(cnt);
```

**Straight Bounding Rectangle**

```javascript
//cv.boundingRect (points)
let rect = cv.boundingRect(cnt);
```

**Rotated Rectangle**

```javascript
//cv.minAreaRect (points)
let rotatedRect = cv.minAreaRect(cnt);
```

**Minimum Enclosing Circle**

```javascript
//cv.minEnclosingCircle (points)
let circle = cv.minEnclosingCircle(cnt);

//cv.circle (img, center, radius, color, thickness = 1, lineType = cv.LINE_8, shift = 0)
cv.circle(dst, circle.center, circle.radius, circleColor);
```

**Fitting an Ellipse**

```javascript
//cv.fitEllipse (points)
let rotatedRect = cv.fitEllipse(cnt);

//cv.ellipse1 (img, box, color, thickness = 1, lineType = cv.LINE_8)
cv.ellipse1(dst, rotatedRect, ellipseColor, 1, cv.LINE_8);
```

**Fitting a Line**

```javascript
//cv.fitLine (points, line, distType, param, reps, aeps)
cv.fitLine(cnt, line, cv.DIST_L2, 0, 0.01, 0.01);

//cv.line (img, pt1, pt2, color, thickness = 1, lineType = cv.LINE_8, shift = 0)
cv.line(dst, point1, point2, lineColor, 2, cv.LINE_AA, 0);
```

**Aspect Ratio**

```javascript
let rect = cv.boundingRect(cnt);
let aspectRatio = rect.width / rect.height;
```

**Extent**

```javascript
let area = cv.contourArea(cnt, false);
let rect = cv.boundingRect(cnt));
let rectArea = rect.width * rect.height;
let extent = area / rectArea;
```

**Solidity**

```javascript
let area = cv.contourArea(cnt, false);
cv.convexHull(cnt, hull, false, true);
let hullArea = cv.contourArea(hull, false);
let solidity = area / hullArea;
```

**Equivalent Diameter**

```javascript
let area = cv.contourArea(cnt, false);
let equiDiameter = Math.sqrt((4 * area) / Math.PI);
```

**Orientation**

```javascript
let rotatedRect = cv.fitEllipse(cnt);
let angle = rotatedRect.angle;
```

**Mask and Pixel Points**

```javascript
//cv.transpose (src, dst)
cv.transpose(src, dst);
```

**Maximum Value, Minimum Value and their locations**

```javascript
//cv.minMaxLoc(src, mask)
let result = cv.minMaxLoc(src, mask);
let minVal = result.minVal;
let maxVal = result.maxVal;
let minLoc = result.minLoc;
let maxLoc = result.maxLoc;
```

**Mean Color or Mean Intensity**

```javascript
cv.mean(src, mask);
```

**Convexity Defects**

```javascript
//cv.convexityDefects (contour, convexhull, convexityDefect)
cv.convexityDefects(cnt, hull, defect);
```

**Point Polygon Test**

```javascript
//cv.pointPolygonTest (contour, pt, measureDist)
let dist = cv.pointPolygonTest(cnt, new cv.Point(50, 50), true);
```

**Match Shapes**

```javascript
//cv.matchShapes (contour1, contour2, method, parameter)
let result = cv.matchShapes(
  contours.get(contourID0),
  contours.get(contourID1),
  1,
  0,
);
```

**Find Histogram**

```javascript
//cv.calcHist (image, channels, mask, hist, histSize, ranges, accumulate = false)
cv.calcHist(srcVec, channels, mask, hist, histSize, ranges, accumulate);
```

**Histograms Equalization**

```javascript
cv.equalizeHist(src, dst);
```

**CLAHE (Contrast Limited Adaptive Histogram Equalization)**

```javascript
//cv.CLAHE (clipLimit = 40, tileGridSize = new cv.Size(8, 8))
let clahe = new cv.CLAHE(40, tileGridSize);
```

**Backprojection**

```javascript
//cv.calcBackProject (images, channels, hist, dst, ranges, scale)
cv.calcBackProject(dstVec, channels, hist, backproj, ranges, 1);

//cv.normalize (src, dst, alpha = 1, beta = 0, norm_type = cv.NORM_L2, dtype = -1, mask = new cv.Mat())
cv.normalize(hist, hist, 0, 255, cv.NORM_MINMAX, -1, none);
```

**Fourier Transform**

```javascript
//cv.dft (src, dst, flags = 0, nonzeroRows = 0)
cv.dft(complexI, complexI);

//cv.getOptimalDFTSize (vecsize)
let optimalRows = cv.getOptimalDFTSize(src.rows);

//cv.copyMakeBorder (src, dst, top, bottom, left, right, borderType, value = new cv.Scalar())
cv.copyMakeBorder(
  src,
  padded,
  0,
  optimalRows - src.rows,
  0,
  optimalCols - src.cols,
  cv.BORDER_CONSTANT,
  s0,
);

//cv.magnitude (x, y, magnitude)
cv.magnitude(planes.get(0), planes.get(1), planes.get(0));

//cv.split (m, mv)
cv.split(complexI, planes);

//cv.merge (mv, dst)
cv.merge(planes, complexI);
```

**Template Matching**

```javascript
//cv.matchTemplate (image, templ, result, method, mask = new cv.Mat())
cv.matchTemplate(src, templ, dst, cv.TM_CCOEFF, mask);
```

**Hough Transform**

```javascript
//cv.HoughLines (image, lines, rho, theta, threshold, srn = 0, stn = 0, min_theta = 0, max_theta = Math.PI)
cv.HoughLines(src, lines, 1, Math.PI / 180, 30, 0, 0, 0, Math.PI);
```

**Probabilistic Hough Transform**

```javascript
//cv.HoughLinesP (image, lines, rho, theta, threshold, minLineLength = 0, maxLineGap = 0)
cv.HoughLinesP(src, lines, 1, Math.PI / 180, 2, 0, 0);
```

**Hough Circle Transform**

```javascript
//cv.HoughCircles (image, circles, method, dp, minDist, param1 = 100, param2 = 100, minRadius = 0, maxRadius = 0)
cv.HoughCircles(src, circles, cv.HOUGH_GRADIENT, 1, 45, 75, 40, 0, 0);
```

**Threshold**

```javascript
cv.threshold(gray, gray, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
```

**Distance Transform**

```javascript
//cv.distanceTransform (src, dst, distanceType, maskSize, labelType = cv.CV_32F)
cv.distanceTransform(opening, distTrans, cv.DIST_L2, 5);
```

**mage Watershed**

```javascript
//cv.connectedComponents (image, labels, connectivity = 8, ltype = cv.CV_32S)
cv.connectedComponents(coinsFg, markers);

//cv.watershed (image, markers)
cv.watershed(src, markers);
```

**Foreground Extraction**

```javascript
//cv.grabCut (image, mask, rect, bgdModel, fgdModel, iterCount, mode = cv.GC_EVAL)
cv.grabCut(src, mask, rect, bgdModel, fgdModel, 1, cv.GC_INIT_WITH_RECT);
```

**Meanshift**

```javascript
//cv.meanShift (probImage, window, criteria)
[, trackWindow] = cv.meanShift(dst, trackWindow, termCrit);
```

**Camshift**

```javascript
//cv.CamShift (probImage, window, criteria)
[trackBox, trackWindow] = cv.CamShift(dst, trackWindow, termCrit);
```

**Lucas-Kanade Optical Flow**

```javascript
//cv.calcOpticalFlowPyrLK (prevImg, nextImg, prevPts, nextPts, status, err, winSize = new cv.Size(21, 21), maxLevel = 3, criteria = new cv.TermCriteria(cv.TermCriteria_COUNT+ cv.TermCriteria_EPS, 30, 0.01), flags = 0, minEigThreshold = 1e-4)
let criteria = new cv.TermCriteria(
  cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT,
  10,
  0.03,
);
cv.calcOpticalFlowPyrLK(
  oldGray,
  frameGray,
  p0,
  p1,
  st,
  err,
  winSize,
  maxLevel,
  criteria,
);
```

**Dense Optical Flow**

```javascript
//cv.calcOpticalFlowFarneback (prev, next, flow, pyrScale, levels, winsize, iterations, polyN, polySigma, flags)
cv.calcOpticalFlowFarneback(prvs, next, flow, 0.5, 3, 15, 3, 5, 1.2, 0);
```

**BackgroundSubtractorMOG2**

```javascript
//cv.BackgroundSubtractorMOG2 (history = 500, varThreshold = 16, detectShadows = true)
let fgbg = new cv.BackgroundSubtractorMOG2(500, 16, true);

//cv.apply (image, fgmask, learningRate = -1)
fgbg.apply(frame, fgmask);
```

**Haar-cascade Detection**

```javascript
//detectMultiScale (image, objects, scaleFactor = 1.1, minNeighbors = 3, flags = 0, minSize = new cv.Size(0, 0), maxSize = new cv.Size(0, 0))
let faceCascade = new cv.CascadeClassifier();
faceCascade.load("haarcascade_frontalface_default.xml");
faceCascade.detectMultiScale(gray, faces, 1.1, 3, 0, msize, msize);
```

**image && video**

```javascript
cv.imread();
cv.imshow();
cv.VideoCapture();
```

**other**

```javascript
cv.rectangle();
cv.Canny();
cv.goodFeaturesToTrack();
cv.cartToPolar();
cv.randu();
new cv.ORB();
```

## To Do List

- **Performance**, up speed performance.
- **Methods** complete all the opencv functions.

## License

OpenCVJS is released under the MIT license. See LICENSE for details.
