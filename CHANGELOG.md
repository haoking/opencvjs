# Changelog

## Unreleased

> ⚠️ 本节的改动**尚未发布**。`2.0.0` 已经发出去了，所以这些语义变更不能追记进下面
> 那个 `2.0.0` 小节——那等于声称它们在 2.0.0 里就有，而用户 `npm install` 装到的
> 2.0.0 里并没有。按 semver，带着下面这张表的下一个版本应当是 **major**。

### 破坏性变更

下面这些调用此前要么 abort（抛出的是裸数字，不是 `Error`）、要么静默产出错误数据，
现在抛标准异常。它们都会改变现有代码的**运行时行为**，因此按破坏性变更记录。

> ℹ️ 本节曾经写着「没有一条是原本能正确工作的用法」。**那句话是错的**：最初的
> `guards.number` 图省事用了 `Number.isFinite`，把 `±Infinity` 连同 `NaN` 一起拒了，
> 而 `±Infinity` 在加 guards 之前本来就工作得好好的（实测 `CV_32FC1` 上
> `addConstant(Infinity)` 得到整片 `Infinity`）。已改回放行，见下方「标量运算数」
> 一条。表里其余各条经复核确实都不是原本正确的用法。

| 调用                                         | 此前                     | 现在         |
| -------------------------------------------- | ------------------------ | ------------ |
| `mat.addConstant(undefined)` / `NaN` / `"2"` | 整片 NaN / 静默截断      | `TypeError`  |
| `mat.addConstant(Infinity)` 等               | 正常工作                 | **仍然正常** |
| `mat.colClone(1.5)`                          | 静默取第 1 列            | `TypeError`  |
| `mat.replaceMatOnRow([1], 0)`（数组短）      | 缺的位置写成 NaN / 0     | `RangeError` |
| `mat.addOnCol(1, 7)`（列越界）               | 静默改写堆内存           | `RangeError` |
| `cv.matFromArray(3, 3, CV_32FC1, [1, 2, 3])` | 剩余部分是未初始化堆内存 | `RangeError` |
| `mat.dftSplit()`（多通道）                   | 只读通道 0，静默返回垃圾 | `TypeError`  |
| `mat.dftSplit()`（空 Mat 上）                | 静默越界写堆             | `RangeError` |
| `mat.PTR(9, 9)`（3×3 上）                    | 静默读写别人的堆内存     | `RangeError` |
| `mat.PTR(1.5, 0)`                            | 静默截断成第 1 行        | `TypeError`  |
| `mat.PTR(0, -1)`                             | 被当成「取整行」的哨兵   | `RangeError` |

三条需要展开：

**标量运算数的取值范围。** `addConstant` / `constantSubtract` / `mulConstant` /
`constantDivide` / `addOnCol` / `replaceMatOnPoint` 拒绝非数与 `NaN`，但**放行
`±Infinity`**。三条边界是分开定的：非数才是真正要抓的 bug（`addConstant(undefined)`
返回整片 `NaN` 且不报错）；`NaN` 作为运算数没有正当用途，它会把整个 Mat 一次性毁掉；
而 `±Infinity` 是合法的 IEEE-754 值，在代价图 / 距离图上是标准哨兵，拒掉它等于砍掉
一个原本正确的用法。另外，写进**数据**里的 `NaN` / `Infinity` 完全不受限制
（`replaceMatOnRow` / `replaceMatOnCol` 只查数组长度、不查元素值）——这个不对称是
有意的：运算数作用于整个 Mat，数据只落在指定的格子里。

**`mat.PTR(row, col)` 的负列号。** `col` 的缺省值原本写作 `-1`、判据是 `col < 0`，于是
**任何**负列号都会被当成「取整行」，而不是报错。缺省值已改为 `undefined`：`PTR(row)`
与 `PTR(row, undefined)` 照旧取整行，负列号则如实报越界。`-1` 这个哨兵从未出现在
文档或任何调用方里，但它确实是能改变用户代码行为的语义变更。

**空 Mat 上的 `mat.dftSplit()`。** 它内部无条件写 `PTR(0, 0)`，在 `0×0` 或 `0×N` 的 Mat
上此前是一次静默的越界写；现在抛
`RangeError: Mat.PTR(row, col): row = 0 越界 —— 该 Mat 在这个方向上是空的（长度 0）`。
（`dftSplit` 本就标着 `@deprecated`，正确性没有任何证据支撑。）

### 参数前置校验（`src/js/guards.js`）

扩展层的每个方法、以及 `Mat.PTR()` 本身，现在都在**调用 wasm 之前**校验参数，失败时
抛标准 `TypeError` / `RangeError`，消息里带函数名、参数名、实际收到的值和期望的范围。
覆盖：Rect / 行列 / 对角线下标越界、两个 Mat 的尺寸与类型不匹配、`src` 装不下
`rect`、数组长度不足、非有限的常数、非 Mat 参数、已被 `delete()` 的 Mat，以及
`cv.matFromArray` 的元素个数。（`DATA()` 不收参数，没有可越界的入参。）

这解决的是两类都很难查的故障（均本机实测）：

1. **abort 抛出的不是 `Error` 实例。** 本产物在异常被编译掉的配置下构建，C++ 的
   `CV_Assert` 失败走 abort，emscripten 转成 `throw <裸数字>`——`mat.roi(Rect(1,1,10,10))`
   抛出 `1914504`，`e instanceof Error` 为 `false`、`e.message` 为 `undefined`。
2. **越界的行列号根本不会 abort。** embind 的 `*Ptr(row, col)` 不查边界：3×3 `CV_32FC1`
   （36 字节）上 `PTR(9, 9)` 返回 base+144 字节处的视图，读写落在别人的堆上、不报错。
   `replaceMatOnRect` 等 7 个就地写入方法全由 `PTR()` 逐像素驱动。

这批校验带来的行为变更全部列在上面的「破坏性变更」小节里。

**每个下标只校验一次，不逐像素重复校验。** `rows` / `cols` 是 embind getter，每读一次
都是一次跨语言调用（各约 11 ns），所以：`PTR()` 自己查边界，代价实测 +49%
（+23.7 ns/次）；而扩展层内部那 7 个逐像素写入的方法**不走 `PTR()`**，它们在入口用
一次校验证明整个循环的下标范围合法，循环里直接用原生访问器。三方对照（同一进程内
轮换 6 轮、丢首轮、取最小值）：

| `replaceMatOnRect` 32×32          | 耗时      | 相对旧实现 |
| --------------------------------- | --------- | ---------- |
| 旧：循环调无校验的 `PTR`          | 198.90 ms | —          |
| 若循环改调有校验的 `PTR`          | 362.01 ms | **+82%**   |
| 现在：入口校验 + 循环用原生访问器 | 176.73 ms | **−11%**   |

比旧实现还快，是因为顺带把逐像素的 `depth()` 调用（约 5.7 ns/次）也提到了循环外。

> ℹ️ 上表那个 `+82%` 的基准是**旧实现**（198.90 ms）。性能门禁打印的
> 「退化参照 1.8–2.1x」基准则是**「循环走原生访问器」的参照实现**，两者口径不同、
> 都对。要引用倍数请以门禁的输出为准——源码注释里一度出现过 38% / 82% / 105%
> 三种说法（各自来自不同口径的对照），已统一。

新增性能门禁 `test/bench/inplace-ops.bench.js`，专门盯住这个分工：它拿「循环走原生
访问器」的参照实现当基准，被测实现超过 1.5× 即失败。原有的
`test/bench/region-ops.bench.js` 覆盖不到这里——它测的是 `roiClone()`，而 `roiClone()`
内部是「原生 roi + clone」，根本不经过 `PTR`、也不逐像素循环。实测把 `rectAdd` 的循环
改回调 `PTR` 之后：新门禁以退出码 1 失败并打印 `1.96x`，旧门禁照样打印「✅ 性能达标」
并退出码 0。`npm run bench` 现在按 glob 跑 `test/bench/*.bench.js` 下的全部门禁。

### TypeScript 类型声明（`dist/index.d.ts`）

新增 `package.json` 的 `types` 字段。声明**由构建产物自动 dump**（`build/gen-types.js`，
`build/assemble.sh` 组装时执行），不是手写的：顶层符号取自运行时的 `Object.keys(cv)`
（1450 个），Mat 成员取自其整条原型链（75 个，含 embind 的 `delete` / `isDeleted` /
`deleteLater` / `isAliasOf`——它们在 `ClassHandle.prototype` 上，只 dump
`Mat.prototype` 会漏掉）。

`test/types/dts-consistency.test.js` 双向断言声明的符号集与运行时严格相等。这条断言
是这件事的全部意义：生态里现有的 OpenCV.js 声明（`@opencvjs/types`、TechStark 的
`src/`）声明了运行时没有的 `SIFT` / `PCA` / `FlannBasedMatcher`，又漏掉了确实存在的
`FaceDetectorYN`，结果是代码通过类型检查、运行时才抛异常。

范围：只保证**符号存在性**与运行时一致；未逐条标注的原生绑定是
`(...args: any[]): any`（精确到每个参数需要解析 C++ 签名并复现 embind 的重载分发，
超出本项目范围），本项目自己写的扩展层有准确签名。本产物**没有** `Symbol.dispose`
（实测 Mat 原型链上无任何 symbol 属性），所以用不了 TS 5.2 的 `using`。

### SIMD 双产物与运行时探测

`npm` 包现在同时带两份 wasm 产物，入口按运行时能力自选：

```
dist/baseline/opencv.js + opencv_js.wasm   无 SIMD，任何环境都能跑
dist/simd/opencv.js     + opencv_js.wasm   -msimd128 编译
```

**这是 `dist/` 布局的破坏性变更**：`dist/opencv.js` 与 `dist/opencv_js.wasm` 不再位于
顶层。`main`（`dist/index.js`）与 `types` 的路径不变，`loadOpenCV()` 的调用方式也
向后兼容（新增的 `options` 是可选的），所以只有直接深引用 `@haoking/opencvjs/dist/opencv.js`
的代码会断。

必须分目录，不是布局偏好：两个变体的 `.wasm` 文件名都是编译期烘焙进 glue 的常量
`"opencv_js.wasm"`（emscripten 的 `{{{ WASM_BINARY_FILE }}}`，取值来自 CMake 目标名
`opencv_js`），改名会让运行时去取一个不存在的路径，同名放同一个目录必然互相覆盖。
两个变体的 glue 内容也不同，不能共用一份。

**变体选择**：`loadOpenCV({ simd })` > 环境变量 `OPENCV_SIMD` > 运行时探测。
探测用 `WebAssembly.validate()` 校验一个 31 字节、返回 `v128` 的模块——用 `validate`
而非 `compile`/`instantiate`，是因为它同步返回 `boolean`，而变体决策必须在 `require`
之前完成。

**被明确点名的变体若不存在会抛错，不会悄悄换另一个。** 只有自动探测那条路径才回落
（并打一条 warning）。理由：`OPENCV_SIMD=1` 若在缺 SIMD 产物时静默回落，「强制 SIMD
跑一遍测试」实际测的就是 baseline，而结果会宣称测的是 SIMD。`OPENCV_SIMD` 的值拼错
（`ture`）同样抛错而不是被忽略。

**代价**：包体积解包 8.3 MB → **19.4 MB**（tarball 6.0 MB）。SIMD 那份 wasm 本身
就比 baseline 大 21.7%（10,363,503 B vs 8,515,975 B；brotli 后 2.25 MB vs 1.99 MB）。
这是 SIMD 浏览器覆盖率只有 93.57%（Chrome 91+ / Firefox 89+ / Safari 16.4+）的必然
结果——baseline 是必需的回退，不能只发 SIMD。

**已知限制：一个进程里只能加载一个变体。** OpenCV 的 UMD 外壳末尾是
`if (typeof Module === 'undefined') Module = {}; return cv(Module);`，`Module = {}`
没有声明关键字而整个外壳不是严格模式，于是它是隐式全局变量。实测第一个变体加载后
`global.Module === cv` 为 true，第二个变体再 `require` 时会把同一个对象喂给自己的
工厂，embind 抛 `Cannot register public name 'IntVector' twice`。正常用法不受影响；
要对比两个变体请开两个进程。

### 构建变体

`build/build.sh` 从「硬编码 `--disable_single_file`」改为三变体：

| 参数            | 变体         | 产物                                           |
| --------------- | ------------ | ---------------------------------------------- |
| （无）          | `baseline`   | `opencv.js` + `opencv_js.wasm`                 |
| `--simd`        | `simd`       | `opencv.js` + `opencv_js.wasm`                 |
| `--single-file` | `singlefile` | 只有 `opencv.js`（wasm base64 内联，约 11 MB） |

单文件变体供浏览器 `<script>` 直接引用，**不进 npm 包**，只作为 CI artifact 产出。
它刻意走 baseline 而非 SIMD：`<script>` 那条路径上没有任何回退机制。

`build-wasm.yml` 改为三变体并行矩阵（`fail-fast: false`），三者都跑冒烟测试与
raw/gzip/brotli 体积报告，另加一个 `verify` 作业当场验双产物一致性。
`concurrency` 保持 `cancel-in-progress: false`——那一段是 workflow 级的，作用对象是
整个 run，三个矩阵作业共用一个并发名额、彼此不排队也不取消。代价是一次 run 的
CI 分钟数变成三倍（墙钟时间不变，约 11 分钟）。

### 测试

189 项 → 205 项（0 fail）：新增 12 项 SIMD 探测用例、2 项双产物一致性用例
（另有本轮复审带来的 2 项）。CI 里同一套断言会在两个变体上**各跑一遍**。

一致性用例把同一份确定性输入喂给两个变体，逐元素比较 14 个操作的输出。整数内核与
扩展层要求**逐位相同**；浮点内核用的是 OpenCV 自己的判据

    max|a − b|  <=  1e-5 × max(‖baseline‖∞, 1)

公式与常数都取自上游（`CV_PyramidBaseTest::get_success_error_level` 的 1e-5 +
`CV_FilterBaseTest` 的 `element_wise_relative_error = false` + `cmpEps()` 里
`maxval = norm(refarr, NORM_INF)`）。没有按算子分档，因为分档在这里只会放松：
上游同族是 pyrDown/blur/GaussianBlur 1e-5、filter2D 1e-4、Sobel 5e-4，
统一取最严的 1e-5，对本表每个算子都比上游更严。

实测（真实产物）：14 个用例里 12 个**逐位相同**；`pyrDown 32FC4` 判据值 1.31e-7
（余量 76x）、`Sobel 32FC1` 8.68e-8（余量 115x）。

另有一条哈希断言要求两个变体的 `.wasm` 不同——必要条件而非充分条件，但挡得住
「`--simd` 被静默忽略、两条构建路径产出同一份东西、而所有断言照样全绿」这种最
现实的故障。首次真实构建时它如期通过（8,515,975 B vs 10,363,503 B）。

`npm run simd:compare` 打印 12 个操作的实测加速比。它**刻意永远 exit 0**：
实测确实有更慢的项（`dft CV_32FC1` 0.91x）。把「必须更快」做成门禁，结果只会是
以后有人删门禁或只挑有利的算子来测。

### SIMD 首次真实构建的结果

`-msimd128` + emsdk 3.1.64 + OpenCV 4.14.0 这个组合**能编**，三个变体全部通过
（run 30379642633）。实测加速比见 README 的「SIMD 实测加速比」一节。两处要点：

- **`dft CV_32FC1` 是 0.91x（更慢）**，超出 ±3% 的噪声底，是真实退化。
- **上游 2020 年那个反例没有复现**：上游测得 `blur CV_32FC1` 0.519x，这里是 1.55x。
  而 `GaussianBlur` 3.32x vs 上游 3.36x、`pyrDown` 3.27x vs 3.09x 几乎吻合。
  结论是那组六年前的逐 kernel 数据不能整体照搬，具体算子只能实测。

首次构建暴露并修掉了一致性判据本身的一个错误（用逐元素相对差度量卷积输出，
在抵消严重的像素上会把 1.6 ulp 放大成「752 ulp」）——详见提交 `caf9c1f`。

## 2.0.0 — 2026-07-28

**换产物 + 重写扩展层。** 发布产物由仓库里那份 2018 年的 asm.js 单文件
（13.9 MB，基线 OpenCV 4.0.1）换成本仓库自建的 WebAssembly 产物
（`opencv.js` glue 143,365 B + `opencv_js.wasm` 8,515,975 B，基线 OpenCV 4.14.0）；
手写扩展层从「补丁进那个单文件」重写为 `src/js/` 下的五个模块，随包组装进 `dist/`。

迁移指南：[`docs/MIGRATION-2.0.md`](docs/MIGRATION-2.0.md)。

### 破坏性变更

**1. 加载方式：包入口返回 Promise，必须 `await`。**

```javascript
// 1.x
const cv = require("@haoking/opencvjs");
// 2.0
const cv = await require("@haoking/opencvjs")();
```

判断就绪只能看 `typeof cv.Mat === "function"`。`await` 之后
`cv.onRuntimeInitialized` 这个属性**依然存在**（实测 `typeof` 为 `function`），
用它判断会恒真——本项目第一次 CI 冒烟测试就栽在这里。

**2. 不再是「一个 .js 文件」。** 产物是 glue + 独立的 `.wasm` 两个文件，且必须同目录、
同名（glue 内部引用的是编译期写死的字符串 `"opencv_js.wasm"`）。扩展层是 CommonJS
模块，浏览器里直接 `<script>` 引 `dist/opencv.js` 只能拿到原生 OpenCV，要用扩展层
得走打包器。1.x 那种「一个文件丢进浏览器」的用法在 2.0 没有等价物。

**3. 包结构：`main` 由 `opencv.js` 改为 `dist/index.js`；`files` 不再包含仓库根那份
13.9 MB 的 asm.js 产物。** `dist/` 由 `build/assemble.sh` 组装、不入 git（发布前必须
先 `npm run assemble`，否则 `prepack` 直接失败）。

**4. 不再覆盖 OpenCV 原生方法。** 1.x 把修复直接盖在原生 `roi()` / `col()` / `diag()`
上，代价是原生的视图语义被静默改掉。2.0 归还原生方法，修复版改名：

| 1.x                 | 2.0                           |
| ------------------- | ----------------------------- |
| `mat.roi(rect)`     | `mat.roiClone(rect)`          |
| `mat.col(d)`        | `mat.colClone(d)`             |
| `mat.Diag(d)`       | `mat.diagClone(d)`            |
| `mat.reshape(rows)` | `mat.reshapeRows(rows)`       |
| `mat._roi(rect)`    | `mat.roi(rect)`（转义名取消） |
| `mat._col(d)`       | `mat.col(d)`（转义名取消）    |

连带效果：**1.0.0 那条「多通道上 `roi()`/`col()`/`Diag()` 返回副本而非视图」的破坏性
变更，在 2.0 里被这次改名取代**——原生三个方法恢复为 OpenCV 本来的视图语义，
`mat.roi(rect).setTo(...)` 又能写回源 Mat 了；要副本请用 `*Clone`。

`reshape` 的改名理由与其余几个不同：这个产物的 embind 绑定里**根本没有**
`Mat::reshape`（实测 `typeof cv.Mat.prototype.reshape === "undefined"`），1.x 并没有
覆盖任何东西。改名是为腾出这个名字，同时把语义差异摆明——原生 `reshape()` 返回共享
内存的新 header，`reshapeRows()` 返回副本。2.0 另加了整除校验（`reshapeRows(4)` 对
3×3 抛 `RangeError`，1.x 静默产出错误形状）。

**5. 删除 8 个手写方法，改用产物里的原生等价函数**（其中三个 1.x 版本本来就是坏的）：

| 删除                           | 改用                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `Mat#mmul(b)`                  | `cv.gemm(a, b, 1, noop, 0, dst, 0)`                            |
| `Mat#vconcat(b)`               | `cv.vconcat(matVector, dst)`（参数由 Mat 变 MatVector）        |
| `Mat#hconcat(b)`               | `cv.hconcat(matVector, dst)`                                   |
| `Mat#mds()`                    | `cv.meanStdDev(src, mean, stddev)` —— 1.x 版本 100% 抛异常     |
| `Mat#svd()`                    | `cv.SVDecomp(src, w, u, vt, flags)`                            |
| `Mat#RodriguesFromMat()`       | `cv.Rodrigues(src, dst)`                                       |
| `cv.RodriguesFromArray(arr)`   | `cv.Rodrigues(src, dst)`                                       |
| `cv.mulSpectrums2Channel(...)` | `cv.mulSpectrums(a, b, dst, flags, conjB)` —— 1.x 版本返回 NaN |

另有 **`cv.mulSpectrums` 名字保留但换成了原生实现**，签名随之改变：
`(a, b, conjB)` → `(a, b, dst, flags, conjB)`。1.x 的手写版返回无效结果，见「修复」。

为此在构建白名单里放行了 core 的 `mulSpectrums` 与 `SVDecomp`（上游默认不导出）。

**6. 内联的 numeric.js 库连同 `numeric.sum` / `numeric.svd` 的调用一并删除。**
`Mat#sum()` 改为纯 JS 累加，行为不变（仍是所有元素含各通道的标量和，与 OpenCV 的
`cv.sum()` 语义不同——后者返回逐通道 Scalar，且**不在本产物的白名单里**）。

**7. `Mat#dftSplit()` 标记 `@deprecated`**（代码保留）。它的 CCS 展开约定从未被独立
验证过，且 1.x 时代唯一的消费者就是那个返回 NaN 的 `mulSpectrums`——不存在「它以前
工作正常」这回事。需要复数谱相乘请直接用原生 `cv.mulSpectrums`。

**8. 基线由 OpenCV 4.0.1 跳到 4.14.0**，跨越七年上游变更。本仓库只验证了扩展层涉及
的那批函数；其余原生 API 的行为差异请查 OpenCV 自己的变更记录。另：dnn 的 JS 绑定
已从白名单裁掉（`cv.readNetFromTensorflow` 等为 `undefined`；dnn 的 C++ 代码仍在产物
里——白名单只控制 embind 绑定生成）。`CascadeClassifier` 保留（冒烟测试有断言）。

### 修复

- **`mds()` 100% 抛 `TypeError: src1Array.reduce is not a function`**（实现里写的是
  `this.DATA` 而非 `this.DATA()`，取到函数对象）。→ 删除，改用 `cv.meanStdDev`，
  实测 3×3 值 1..9 上 mean = 5、stddev = 2.5819888974716108。

- **`mulSpectrums()` / `mulSpectrums2Channel()` 返回无效结果**：部分元素恒为 `NaN`，
  另一部分每次运行都不同（读到未初始化的堆内存）。→ 换原生，实测
  CCS `[1,2,3,4]×[5,6,7,8]` → `5, -9, 32, 32`；`CV_32FC2` `(1+2i)(5+6i)`、`(3+4i)(7+8i)`
  → `-7, 16, -11, 52`，`conjB` → `17, 4, 53, 4`，均无 NaN，且输出 `channels()` 与输入
  一致（1.x 手写版对 `CV_32FC2` 输入返回 `channels() === 1`）。

- **`replaceMatOnRow()` 在非 `CV_32F` 的 Mat 上静默写坏内存并越界。**
  README 1.x 把这条记作「仅支持 CV_32F 类型」，措辞不准：它不抛异常。embind 的
  `floatPtr` **不做类型校验**，`CV_8UC1` 的 2×3 Mat（6 字节）上 `floatPtr(0)` 返回长度
  3 的 `Float32Array`（12 字节），写入即越界 6 字节，且不报任何错。实测 1.x 在该 Mat
  上把数据改成 `0,0,32,65,0,0`；`CV_32SC1` 上改成 `1092616192,1101004800,1106247680,4,5,6`。
  → 改走类型分发的 `PTR()`，七种深度实测全部得到 `10,20,30,4,5,6`。

- **`constantDivide()` 在多通道 Mat 上把通道 1+ 除以 0。** 被除数用
  `new cv.Scalar(constant)` 填充，而 Scalar 缺省分量是 0——实测填 `CV_32FC3` 得
  `16,0,0,16,0,0`。→ 改用 `new cv.Scalar(c, c, c, c)`，7 深度 × 4 通道共 28 组实测全对。
  （不能用 `cv.Scalar.all(c)`：glue 里写的是 `Scalar.all = v => Scalar(v,v,v,v)`，
  漏了 `new`，调用即抛 `TypeError: this.push is not a function`。这是 glue 自带 JS 辅助
  函数的缺陷，与白名单无关。）

- **`replaceMatOnPoint()` 的形参名与语义相反、且文档记载的 `(value, point)` 重载不存在。**
  1.x 是 `(constant, x, y)` → `PTR(x, y)`，`x` 实为行号。→ 2.0 统一为
  `(value, row, col)`，并真正实现 `(value, point)`（按 `cv.Point` 约定 x = 列、y = 行）；
  少给 `col` 时抛 `TypeError` 而不是拿 `undefined` 当下标。
  **位置参数的行为与 1.x 逐字相同**（第 2 个参数一直是行、第 3 个一直是列），
  已经在跑的三参调用不用改。

- **`DATA()` / `PTR()` 对 >4 通道的 Mat 返回 `undefined`。** 旧实现是 28 路 switch
  （7 深度 × 4 通道），而通道数根本不参与选择。→ 改为按 `depth()` 查表。

### 新增

- `build/assemble.sh`：把 wasm 产物与 `src/js/` 组装成可发布的 `dist/`。
- `docs/MIGRATION-2.0.md`：逐条迁移指南。
- 测试从 114 项增加到 135 项（134 pass + 1 skip + 0 fail，node v22.22.2 实测），
  新增的 21 项覆盖 2.0 修掉的那批缺陷——它们在 1.x 的产物上根本跑不起来。
- CI 的 `npm test` / `npm run bench` 改为跑在组装后的 `dist/` 上（取
  `build-wasm.yml` 最近一次成功运行的产物）。

### 性能

同一台机器（node v22.22.2 / darwin-arm64），64×64 `CV_32FC1`、`Rect(1, 1, 32, 32)`、
20000 次：原生 `roi()` + `clone()` 14.0 ms vs `roiClone()` 14.3 ms —— 扩展层本身没有
额外开销（`npm run bench` 的门禁就是这个比值）。

副本相对视图的代价（256×256 `CV_32FC2`、`Rect(0, 0, 128, 128)`、5000 次）：
原生视图 1.2–1.9 ms vs `roiClone()` 20.8–23.3 ms。比值 11–18×（3 次独立测量、
各取第 2–4 轮）——比值本身噪声大，因为视图侧耗时太小；稳定的是绝对值。
**1.0.0 的 CHANGELOG 里那个 41× 是在旧的 asm.js 产物上测的，不适用于 2.0 的产物。**

## 1.0.0 — 2026-07-27

**`@haoking/opencvjs` 在 npm 上的首个发布版本。** 此前本仓库从未发布过 npm 包，
因此下面列出的不是对某个已发布版本的修订，而是相对仓库既有状态（`master` 的
`82b3fcc`，自称 4.0.1）在发布前做的修正与新增。

### 破坏性变更

相对仓库既有状态（不涉及任何已发布版本，但**代码里依赖过旧行为的调用方会静默失效**）。

- **多通道 Mat 上 `roi()` / `col()` / `Diag()` 的返回值，由 OpenCV 原生视图改为独立副本。**

  改动前，`channels() > 1` 时这三个方法直接返回原生视图——与源 Mat 共享内存、O(1)。
  改动后一律 `clone()`。这是修正下方「多通道路径静默返回错误数据」的必要代价：
  原生视图非连续，而 `.data*` 会按连续内存直读。

  **受影响的写法**：`mat.roi(rect).setTo(...)`、`mat.col(d).setTo(...)` 一类
  「通过返回值写回源 Mat」的操作**不再影响源 Mat，且不会报任何错**。
  单通道路径改动前走的是 cvtColor 往返，本来就产出副本，语义不变。

  **迁移**：需要视图语义时改用未被覆盖的原生方法——`mat._roi(rect)`、`mat._col(d)`、
  `mat.diag(d)`。但请只把视图用于写回源 Mat：对多通道 Mat 读它的 `.data*` 仍然是错的
  （那正是本次修复的对象）。

  **性能代价**：256×256 `CV_32FC2` 上取 `Rect(0, 0, 128, 128)` 区域、5000 次调用，
  `_roi()` 视图 1.4 ms vs `roi()` 副本 57.0 ms —— 慢约 **41×**
  （node v22.22.2 / darwin-arm64，丢弃预热轮后 4 次独立测量落在 40.7–41.7×；
  另一次独立测量得 48.5×）。区域越大、通道数越多，这个代价越高。

### 修复

- **`roi()` / `col()` / `Diag()` 在 `CV_8S` / `CV_16S` / `CV_32S` / `CV_64F` 上崩溃。**
  旧实现用 `cvtColor(GRAY2BGR)` → 操作 → `cvtColor(BGR2GRAY)` 往返来制造连续副本，
  而 `cvtColor` 只支持 8U/16U/32F，其余深度直接 abort。改用 `clone()`。

- **`roi()` / `col()` / `Diag()` 在多通道 Mat 上静默返回错误数据。**
  多通道走的是「直接返回原生视图」分支，视图非连续，`.data*` 会按连续内存直读。
  例：3×3 `CV_32FC2` 上 `col(2)` 返回 `5,6,7,8,9,10`，正确值是 `5,6,11,12,17,18`。
  该缺陷不报错、不崩溃，实际危害高于上一条。

- **单通道性能**：`roi()` 相比旧的 `cvtColor` 往返实现提速 **5.8–8.6×**
  （64×64 `CV_32FC1`、`Rect(1, 1, 32, 32)`、单次测量 15000–20000 次；
  这是多次独立测量的区间，不是单次结果）。
  只测过 `roi()`；`col()` / `Diag()` 未做过同类测量，不作宣称。
  多通道方向相反，见上方「破坏性变更」。

- **内存**：释放 `roi` / `col` / `Diag` 内部此前泄漏的中间 Mat。旧实现每次调用泄漏一个
  中间 Mat，实测第 43105 次调用时堆耗尽并 abort。

### 新增

- 零依赖测试栈（`node:test`），113 个用例：84 组区域操作正确性（7 深度 × 4 通道 ×
  `roi`/`col`/`Diag`）+ 29 组 `clone()` 深拷贝与副本语义断言。另有 1 个默认跳过的
  wasm 产物冒烟测试（需 `OPENCV_ARTIFACT`）。
- 性能回归门禁（`npm run bench`）。
- 可复现的 OpenCV 4.x WASM 构建链路（Docker + GitHub Actions，手动触发）。
  **该链路尚未跑通过一次**，本版本的发布产物仍是仓库既有的 asm.js。

### 文档

- 订正 README 中与实现不符的宣称与示例期望值。当前仍存在的缺陷清单见
  `README.md` 的 **Known Issues** 一节。
