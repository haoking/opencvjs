# opencvjs 重建设计（修 bug + 全面升级）

日期：2026-07-27
状态：待评审

---

## 1. 背景

本仓库当前只有 4 个文件：`opencv.js`（13.9 MB / 582 行）、`README.md`（1353 行）、`Test.html`、`LICENSE`。没有 C++ 源码、没有 emscripten 配置、没有构建脚本、没有测试、没有 CI。最后一次提交是 2020-12-14，基线是 OpenCV 4.0.1。

`opencv.js` 由两层拼接而成：

- **第 1–41 行（约 13.8 MB）**：UMD wrapper + Emscripten 编译的 OpenCV 4.0.1，产物是 **asm.js 而非 WebAssembly**（文件中无 `WebAssembly` 字样，有 `// EMSCRIPTEN_END_ASM` 标记）。API 名以数字字节数组形式存于数据段。
- **第 42–582 行（约 128 KB）**：手写 JS 扩展层，在 `cv.Mat.prototype` 上挂载 31 个方法。

README 首页的三条核心宣称（修复了官方的 bug、支持全部 1–4 通道、性能大幅提升）经实测均不成立，详见第 2 节。

### 1.1 上游事实（2026-07 调研，含来源）

- **官方 OpenCV.js 并非停更，而是从来就不是官方发布产物。** 核心维护者 opencv-alalek 在 [opencv#25425](https://github.com/opencv/opencv/issues/25425)（2024-04，至今 open）：「Due to this there is no official OpenCV JS release. We don't recommend to use that file directly in your projects.」
- `docs.opencv.org/4.x/opencv.js` 是文档 nightly 构建的副产品，构建容器钉在 **emsdk 1.39.0（2019-10）**，无 SIMD、无 threads，且**不带任何 CORS/CORP 响应头**——因此无法在 cross-origin isolated 页面加载。
- npm 包请求 [opencv#15315](https://github.com/opencv/opencv/issues/15315) 自 2019-08 open 至今。
- **全网无任何预编译的 SIMD 版本。** 官方 4.x/5.x、`@techstark/opencv-js`、`@opencvjs/web` 四个产物经 bytecode 级验证，声明 `v128` 的函数数量均为 0。
- **无任何包使用 `--disable_single_file`。** 所有产物都把 wasm 以 base64 内联进 JS，体积膨胀 33%，且强制按 JS 字符串字面量解析而非流式编译。
- **OpenCV 5.x 移除了一批 JS API**：`CascadeClassifier`、`HOGDescriptor`、`AKAZE`/`BRISK`/`KAZE`、`readNetFromCaffe`/`readNetFromDarknet`。且 5.0 体积 gzip 后比 4.13 大 32%，无性能补偿。
- **官方质量参照**（已逐条核对 GitHub 原始记录）：[PR #26643](https://github.com/opencv/opencv/pull/26643)「js: Rename Mat::clone binding because it is used in Emscripten」2024-12-19 合入 4.11.0。它的**意图**是修复 emscripten 3.1.71+ 的 `ClassHandle.clone()` 与 `Mat::clone` 的命名冲突（改动仅 2 行）；**副作用**是 JS 侧 `mat.clone()` 转而落到 embind 基类那个引用计数式的浅拷贝上。外部用户 7 个月后才报告（[issue #27572](https://github.com/opencv/opencv/issues/27572)，2025-07-24，标题即「最新版本4.12.x中，clone似乎成了浅拷贝，我不得不使用copyTo」），2025-12-09 关闭于 4.13.0——退化共存续约 12 个月。该仓库总共约 10 个 CI 测试。
- **体积实测**：4.13.0 = 10.46 MB raw / 3.38 MB gzip / 2.43 MB brotli；5.0 = 15.46 MB / 4.45 MB / 3.13 MB。
- **裁剪天花板很低**：[opencv#21431](https://github.com/opencv/opencv/issues/21431) 显示白名单只留 10 个函数，single-file 仍有 1.6 MB。
- **SIMD 真实收益**（[opencv#18068](https://github.com/opencv/opencv/pull/18068)，2020）：resize 1.77×、pyrDown 3.09×、gaussianBlur 3.36×，但 **blur CV_32FC1 为 0.519×（比 scalar 慢一倍）**。
- **threads 不可用**：Worker 中已知失效两年（[opencv#25790](https://github.com/opencv/opencv/issues/25790)，`community help requested` 标签，零回复）。
- **`Symbol.dispose` 已于 2025-08 合并**（PR #27613），4.13.0 起可配合 TypeScript 5.2+ 的 `using` 语法。
- WASM SIMD 浏览器支持率 **93.57%**（Chrome 91+ / Firefox 89+ / Safari 16.4+，caniuse 2026-07）。

未复核的不确定项见第 11 节。

---

## 2. 已确认的缺陷（全部经本机实测）

### P0 — 调用即崩溃（可捕获，但功能完全不可用）

| 缺陷                                                                        | 实测                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roi()` / `col()` / `Diag()` 对 `CV_8S`/`CV_16S`/`CV_32S`/`CV_64F` 全部崩溃 | 根因：`opencv.js:302-310` 等用 `cvtColor(GRAY2BGR)` → 操作 → `cvtColor(BGR2GRAY)` 绕开单通道限制，而 cvtColor 只支持 8U/16U/32F。崩溃形式为 emscripten 的 `Exception catching is disabled`——抛出物是**数字**而非 `Error` 实例（`e.message` 为 `undefined`），但**可以被 try/catch 捕获，且捕获后 cv 模块完全正常**（详见 §7.1 的实测）。定为 P0 的理由是「调用即中止，所有非 8U/16U/32F 深度完全不可用」，不是「不可恢复」。与 commit `1d9d51b` 宣称的「support for all 1,2,3,4 channels」直接矛盾 |
| `mds()` 100% 不可用                                                         | `opencv.js:282` 写的是 `this.DATA` 而非 `this.DATA()`，取到函数对象，立即 `src1Array.reduce is not a function`。README:529 仍将其文档化为公开 API                                                                                                                                                                                                                                                                                                                                                  |

### P0 — 多通道路径静默返回错误数据（比崩溃更危险）

`roi()` / `col()` / `Diag()` 在 `channels() > 1` 时走「直接返回原生视图」分支（`opencv.js:303-305`、`219-221`、`178-180`），不崩溃、不报错，但因视图非连续而**返回错误数据**。3×3 `CV_32FC2` 实测：

| 调用                 | 正确值                   | 当前返回                 |
| -------------------- | ------------------------ | ------------------------ |
| `roi(Rect(1,1,2,2))` | `9,10,11,12,15,16,17,18` | `9,10,11,12,13,14,15,16` |
| `col(2)`             | `5,6,11,12,17,18`        | `5,6,7,8,9,10`           |
| `Diag()`             | `1,2,9,10,17,18`         | `1,2,3,4,5,6`            |

与单通道崩溃同根同源（非连续视图被按连续内存直读），同一个 `.clone()` 修复一并解决。因其无任何报错信号，实际危害高于 P0 崩溃。

### P1 — 静默产出错误结果

- `mulSpectrums()` 返回 `NaN`，且 **README:272 的示例注释里就写着 NaN**——错误输出被当作预期结果写进了文档。
- `replaceMatOnPoint`：README/Test.html 按 `(constant, {x,y})` 调用，实现签名是 `(constant, x, y)`，照文档调用直接抛错。
- `replaceMatOnRow`（`opencv.js:237`）硬编码 `this.floatPtr(d)`，非 32F 类型抛 `start offset of Float32Array should be a multiple of 4`。
- `reshape(rows)`（`opencv.js:160`）覆盖了 OpenCV 原生 `reshape(cn, rows)` 的语义；且用 `matFromArray` 全量拷贝（原生为 O(1) 视图），多通道时 `this.rows * this.cols / rows` 漏算通道数。

### P2 — 与「性能提升」宣称相反

| 操作                               | 原生                   | 当前实现 | 倍数         |
| ---------------------------------- | ---------------------- | -------- | ------------ |
| `roi()` 20000 次（64×64 CV_32FC1） | `_roi()` 12 ms         | 236 ms   | **慢 19.7×** |
| `col()` 20000 次                   | `_col().clone()` 37 ms | 181 ms   | **慢 4.9×**  |

内部临时 Mat 未释放（`roi`/`col`/`Diag` 中的中间 `dst`）。

### 关键洞察：cvtColor hack 解决的是真问题，但药方错了

OpenCV 的 `col()`/`roi()`/`diag()` 返回**非连续视图**（`isContinuous() === false`），此时 `.data32F` 会按连续内存直读，得到错误数据：

```
原生 _col(2):  rows=3 cols=1 isContinuous=false
  .data32F 直接读 → 3,4,5   ← 错的（从偏移 2 起连读 3 个）
  clone() 之后   → 3,6,9   ← 对的
```

作者的 cvtColor 往返副作用是产出连续的新 Mat，所以「看起来对了」。**正确解法是 `.clone()`**：正确性相同、快 4.9×、且对所有类型都有效。

### 基础设施缺失

无 `package.json`、无测试框架、无 CI、无构建脚本。`Test.html` 是 317 行里约 90% 被注释掉的手工调试页，而 README:23 宣称「Every funcation is tested」。README:19 宣称使用 WebAssembly，实为 asm.js。

---

## 3. 目标与非目标

### 目标

1. 成为可长期维护、可复现构建、对外发布的 OpenCV.js 发行版。
2. 修复第 2 节全部已确认缺陷。
3. 升级到 OpenCV 4.x 最新稳定版，产物由 asm.js 换为 WebAssembly。
4. 建立真实的测试与 CI，让 README 的每条宣称都有可执行断言背书。
5. 提供两项当前生态中无人提供的能力：**预编译 SIMD** 与 **拆分 wasm 文件**。

### 非目标

- ~~不跟进 OpenCV 5.x（移除了本项目依赖的 `CascadeClassifier` 等，且体积更大）。~~
  **⚠️ 此条已于 3.0 作废**：基线已升到 OpenCV 5.0.0，`CascadeClassifier` 等确实随之
  消失（这正是 3.0 定为 major 的理由）。当初「体积更大」的依据是官方
  **文档 nightly 构建**的 4.13.0 与 5.0 对比（本节上方那条体积实测），那两份产物的
  白名单和模块集都与本项目不同，数字不可直接迁移。
- 不做 threads（上游 Worker 中已知失效两年）。
- 不追求极限裁剪体积（上游数据显示天花板很低：10 个函数仍有 1.6 MB）。
- 不做 WebGPU 后端（上游 PR 自 2020 年挂起未合）。
- 不保持与 1.x 的完全向后兼容（见第 6 节）。

---

## 4. 关键决策

| #   | 决策                                      | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 定位为长期维护的开源发行版                | 用户选定                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | 对齐 OpenCV 官方语义，发布 2.0 大版本     | 错误签名不长期背负；用过 OpenCV 的人不会被坑                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | 单一精简产物（用户侧一个包、一行 import） | 控制维护成本与 API 面。「精简」= 白名单裁掉 dnn 的 **JS 绑定**，保留 core/imgproc/objdetect/features2d/video/calib3d；不做极限裁剪（见非目标）。**注意这不是体积优化**：白名单只控制 embind 绑定生成，不影响 CMake 是否编译该模块——`build_js.py:126` 硬编码 `-DBUILD_opencv_dnn=ON` 且无 `--disable_dnn` 选项，dnn 的 C++ 代码仍在产物里，体积不会因白名单显著下降（详见 `build/build.sh` 中 `EXTRA_CMAKE_OPTIONS` 透传入口上方的注释） |
| 4   | 构建在 GitHub Actions CI 执行             | 本机零负担；代价是本地无法快速迭代构建，因此 JS 层必须能脱离 wasm 独立测试                                                                                                                                                                                                                                                                                                                                                              |
| 5   | 白名单优先 + 薄 JS 层                     | OpenCV C++ 已有的一律走白名单暴露原生实现，正确性与性能白送                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | 产物移出 git，走 GitHub Release + npm     | wasm 是二进制，压缩率远低于当前的 asm.js 文本，入 git 会快速膨胀                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | 基线钉 OpenCV 4.x 最新稳定版              | 5.x 会移除 `CascadeClassifier`（本项目的人脸追踪卖点依赖它）等 API                                                                                                                                                                                                                                                                                                                                                                      |
| 8   | 双 wasm（baseline + SIMD）+ 运行时探测    | SIMD 覆盖率 93.57%，只出 SIMD 版会让 6.4% 用户无降级路径；探测仅需数行代码，JS 层与测试完全复用                                                                                                                                                                                                                                                                                                                                         |

> **⚠️ 决策 7 已于 3.0 推翻。** 基线改钉 **OpenCV 5.0.0**。理由：5.x 里
> `SVDecomp` / `mulSpectrums`（决策 5「白名单优先」真正依赖的两个原生实现）声明
> 完好、与 4.14.0 逐字节相同，放行即可；而 `CascadeClassifier` 一类的移除已由
> 上游白名单落定，继续钉 4.x 只是把这笔账往后推。代价是 3.0 成为破坏性版本，
> 详见 `CHANGELOG.md`。决策 3 里那句「保留 core/imgproc/objdetect/features2d/
> video/calib3d」在 5.x 的模块命名下应读作 core/imgproc/objdetect/**features**/
> video/**\_3d + calib**（`build_js.py` 的行号也从 126 变成 124）。

npm 包名：`opencvjs` 与 `opencv-js` 均已被占用，发布使用 **`@haoking/opencvjs`**（已验证可用）。

---

## 5. 架构

```
opencvjs/
├── src/
│   ├── config/
│   │   └── opencv_js.config.py       # 模块与函数白名单 —— 配置，不是代码
│   └── js/                           # 唯一手写的运行时代码
│       ├── index.js                  #   入口：探测 SIMD → 选择 wasm → 挂载扩展
│       ├── simd-detect.js            #   WebAssembly.validate 一个含 v128 的最小模块
│       ├── guards.js                 #   参数前置校验（把 WASM 崩溃转成 JS 异常）
│       ├── typed-access.js           #   DATA() / PTR() 类型分发
│       ├── mat-region.js             #   replaceMatOn* / rectAdd / rectSubtract
│       └── dft.js                    #   dftSplit
├── build/
│   ├── Dockerfile                    # 锁死 emsdk 版本
│   └── build.sh                      # 参数：OpenCV tag、白名单路径、--simd、--disable_single_file
├── test/
│   ├── helpers.js                    # Mat 构造、期望值独立计算、安全的异常提取（见 7.1）
│   ├── unit/                         # JS 层单元测试
│   ├── types/                        # 类型 × 通道矩阵测试
│   └── readme-examples/              # 从 README 抽取的可执行断言
├── .github/workflows/
│   ├── ci.yml                        # PR：用缓存的 wasm 产物跑测试
│   └── release.yml                   # tag：Docker 构建 wasm → Release + npm publish
└── docs/
```

### 5.1 产物

CI 产出、不入 git：

- `opencv.js` — JS glue + 扩展层（约 220 KB）
- `opencv.wasm` — baseline
- `opencv-simd.wasm` — SIMD

### 5.2 四条边界

1. **白名单是配置。** `mmul`/`svd`/`Rodrigues`/`mulSpectrums`/`vconcat` 等从「手写 JS 模拟」退化为白名单里的一行。改动需重编译（走 CI），但频率极低。
2. **`--disable_single_file` 是默认。** 恢复流式编译与独立缓存。零风险，且是当前生态中无人提供的能力。
3. **JS 层脱离 wasm 可测。** `src/js/` 每个文件都能对着一份固定的 wasm 产物单独测试——这是决策 4（CI 构建）的必然要求。
4. **产物只从 CI 出。** 本地不产出 `dist/`，杜绝「本机编译结果与 Release 不一致」。

### 5.3 加载流程

```
import 入口
  └→ simd-detect.js: WebAssembly.validate(含 v128 的最小模块)
       ├─ true  → fetch opencv-simd.wasm
       └─ false → fetch opencv.wasm
  └→ 实例化 → 在 cv.Mat.prototype 上挂载扩展层
  └→ resolve(cv)
```

对外暴露 `await loadOpenCV()`（Promise），不再使用现有的 `onload` 回调风格。

---

## 6. 修复策略：按根因收敛

第 2 节的 11 个问题收敛到 3 个根因。

### 根因 A：用 cvtColor 往返绕开非连续视图 → 改用 `.clone()`

一处修改同时解决 `roi`/`col`/`Diag` 的 P0 崩溃、19.7× 性能退化、类型限制三个问题。

**不依赖 wasm 重建，可独立先行交付**（见第 10 节阶段 0）。

### 根因 B：官方白名单未放行，被迫用 JS 模拟 → 改配置

下列 API 改为白名单暴露的原生 C++ 实现：

| 当前实现                                                              | 替换为                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `svd()` — 内联了一份 numeric.js 的纯 JS Golub-Reinsch                 | `cv::SVD`                                               |
| `mmul()` — `cv.gemm` 包装且把未初始化 dst 同时作 src3 传入            | `cv::gemm` 直接暴露                                     |
| `RodriguesFromArray()` / `RodriguesFromMat()` — 手写罗德里格斯公式    | `cv::Rodrigues`                                         |
| `mulSpectrums()` — 手写 DFT 布局拆分，返回 NaN                        | `cv::mulSpectrums`                                      |
| `norm2()`                                                             | `cv::norm(src1, src2, normType)` 双参数重载             |
| `vconcat()` / `hconcat()`                                             | `cv::vconcat` / `cv::hconcat`                           |
| `mds()`                                                               | `cv::meanStdDev`                                        |
| `addConstant` / `constantSubtract` / `mulConstant` / `constantDivide` | `cv::add`/`subtract`/`multiply`/`divide` 的 Scalar 重载 |

`mulSpectrums` 的 NaN 由此一并消除——那是 JS 模拟 DFT 布局时算错的，原生实现无此问题。

### 根因 C：类型分发不完整 / 签名与文档脱节 → 补全并对齐官方语义

`replaceMatOnRow` 硬编码 `floatPtr`、`mds` 漏括号、`replaceMatOnPoint` 签名不一致、`reshape` 覆盖原生签名。

### 6.1 修复后剩余的手写 JS

只剩下 OpenCV 确实没有对应物的部分：

- `DATA()` / `PTR()` — 类型分发访问器
- `replaceMatOnRect` / `replaceMatOnRow` / `replaceMatOnCol` / `replaceMatOnPoint` / `addOnCol`
- `rectAdd` / `rectSubtract`
- `dftSplit` — 把 OpenCV 的 CCS 格式 DFT 输出拆为实部 / 虚部两个 Mat，无原生等价物
- `sumAll()` — 全部元素之和（`cv::sum` 返回的是逐通道 Scalar，语义不同）
- `guards.js` — 参数前置校验

预计从 540 行降至 200 行以内。

### 6.2 覆盖原生方法的处理原则

当前扩展层通过 `_col = col` 再重新赋值的方式**覆盖了 OpenCV 原生的 `col()` / `roi()` / `reshape()`**。这与决策 2（对齐官方语义）直接冲突：用过 OpenCV 的人调用 `m.col(2)` 期望得到一个 O(1) 视图，却拿到一个隐式拷贝。

原则：**2.0 不覆盖任何原生方法。** 需要连续副本的场景由调用方显式表达。

这与根因 A 的修复分两个阶段调和：

- **阶段 0（1.0.0）**：保持现有 API 形状（仍覆盖原生），仅把内部的 cvtColor 往返换成 `.clone()`。现有用户无需改代码即可摆脱 P0 崩溃与性能退化。
- **阶段 4（2.0）**：撤销覆盖，原生 `col()`/`roi()`/`diag()`/`reshape()` 恢复视图语义；需要连续副本改用显式的 `.clone()`。

### 6.3 Breaking changes 清单（2.0）

命名规则：**新增 API 一律不得与 `cv.Mat.prototype` 上的原生方法重名。** 下表中每个新名字都已核对无冲突。

| API                                                                                  | 1.x 行为                                             | 2.0 行为                                                               | 迁移                                                          |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `col()` / `roi()` / `reshape()`                                                      | 覆盖原生；隐式拷贝；`reshape` 还改了签名并漏算通道数 | 撤销覆盖，恢复原生视图语义                                             | 需要副本时显式 `.clone()`；`m.reshape(1)` → `m.reshape(0, 1)` |
| `Diag()`                                                                             | 大写规避与原生 `diag()` 冲突；cvtColor hack          | **移除**。原生 `diag()` 返回视图，需副本用 `m.diag(d).clone()`         | 改用 `m.diag(d).clone()`                                      |
| `sum()`                                                                              | 返回全部元素之和（数字）                             | **更名 `sumAll()`**（`total()` 已被原生占用，返回元素个数，不可用）    | 改用 `sumAll()`                                               |
| `mds()`                                                                              | 崩溃（`this.DATA` 漏括号）                           | **移除**，改用白名单暴露的 `cv.meanStdDev()`                           | 改用 `cv.meanStdDev()`                                        |
| `norm2(a, b)`                                                                        | 自定义包装                                           | **移除**，改用原生 `cv.norm(a, b, normType)`                           | 直接替换                                                      |
| `replaceMatOnPoint`                                                                  | 实现为 `(value, x, y)`，文档为 `(value, point)`      | 统一为 `(value, row, col)`，另接受 `(value, point)` 重载               | 按新签名调整                                                  |
| `mmul` / `svd` / `Rodrigues*` / `mulSpectrums` / `vconcat` / `hconcat` / `*Constant` | 手写 JS 模拟                                         | 保留同名，内部换为白名单暴露的原生实现；`mulSpectrums` 的 NaN 一并消除 | 无需改动（行为修正）                                          |
| 加载方式                                                                             | `<script async onload=...>`                          | `await loadOpenCV()`                                                   | 见迁移文档                                                    |

被移除的 `Diag` / `mds` / `norm2` 保留一个大版本作为 deprecated 别名，调用时 `console.warn` 指向替代方案，2.1 移除。

`row()` 的行/列语义**保持不变**——经核对，README:368/386 的文档是正确的（`m.row(2)` → `7,8,9`、`m.col(2)` → `3,6,9`），不一致的是 Test.html:167-175 中过时的开发期注释。

---

## 7. 测试策略

当前项目最大的缺口。三条非常规要求，均由实测逼出。

### 7.1 abort 可捕获，但抛出物不是 Error 实例

在异常被编译掉的构建下，emscripten 把 C++ 异常表现为抛出一个**数字**（如 `6446944`），附带消息 `Exception catching is disabled, this exception cannot be caught`。

实测结论（本机连续触发 20 次验证）：

- 该 abort **可以被 JS 的 try/catch 捕获**；
- 捕获后 **cv 模块完全正常**，后续 `roi()`、`add()` 等调用不受影响；
- 因此**不需要子进程隔离**，Node 内置的 `node:test` 足够，测试栈保持零依赖。

**关键陷阱**：抛出物不是 `Error` 实例，`e.message` 为 `undefined`。测试辅助函数必须用 `String(e?.message ?? e)` 提取信息——否则测试代码自身会因 `undefined.split` 之类报错而中断，并把这个自伤伪装成「模块已报废」。本设计的早期版本正是据此误判，要求了不必要的子进程隔离架构。

### 7.2 必须显式断言 `clone()` 的深拷贝语义

官方 `mat.clone()` 曾静默退化为浅拷贝达 12 个月无人发现（[PR #26643](https://github.com/opencv/opencv/pull/26643)）。根因 A 的修复正建立在 `clone()` 之上，因此不能假设其正确：测试须在 clone 后修改源 Mat，验证副本不变。

### 7.3 README 示例即测试用例

README 中现存错误的期望值（`mulSpectrums` 注释写着 `NaN`）。将全部示例抽取为可执行断言，使文档与实现无法再各说各话。

### 7.4 覆盖矩阵

- 7 种深度（8U/8S/16U/16S/32S/32F/64F）× 4 种通道 × 全部自定义 API
- 每个 breaking change 的迁移路径
- gzip / brotli 体积回归门禁（超过阈值则 CI 失败）
- SIMD 与 baseline 两份 wasm 跑同一套断言，结果必须一致

---

## 8. 错误处理与内存管理

### 8.1 把不可捕获的 WASM 崩溃转成可捕获的 JS 异常

这是薄 JS 层存在的核心正当理由之一。当前一次类型不匹配即导致整个 cv 模块报废且无法恢复。

`guards.js` 在调用 wasm 前校验：

- Mat 类型是否在该操作的支持集合内
- 矩阵维度是否匹配（如 `mmul` 的 `a.cols === b.rows`）
- Rect / 索引是否越界
- Mat 是否已被 `delete()`

校验失败抛标准 `TypeError` / `RangeError`，附带实际收到的类型与期望集合。

OOM 在当前构建下表现为裸数字（`Uncaught 6620760`）。加载器捕获这类数字异常并包装为带说明的 Error。

### 8.2 内存管理

- 现有 API 返回的 Mat 由调用方 `delete()`，此约定保留并在文档中明确。
- 修复内部临时 Mat 泄漏（`roi`/`col`/`Diag` 中间对象）。
- OpenCV 4.13+ 已带 `Symbol.dispose`，导出 TypeScript 类型声明以支持 TS 5.2+ 的 `using` 语法：

```ts
using mat = cv.matFromArray(3, 3, cv.CV_32FC1, data);
// 作用域结束自动释放
```

### 8.3 TypeScript 类型声明

生态中现有的 `.d.ts`（`@opencvjs/types`、TechStark 的 `src/`）**与运行时不符**——声明了运行时不存在的 `CascadeClassifier`（5.x）、`SIFT`、`PCA`、`FlannBasedMatcher`，又漏掉了确实存在的 `FaceDetectorYN`。血统可追溯到 2019 年的 mirada，手工维护。

本项目的 `.d.ts` **由构建产物的 `Object.keys(cv)` dump 自动生成**，并加 CI 断言确保声明与运行时一致。这是相对现有生态的又一处改进。

---

## 9. 构建与发布

### 9.1 构建

`build/Dockerfile` 锁死 emsdk 版本（官方 nightly 仍钉在 2019 年的 1.39.0，本项目使用与目标 OpenCV 版本匹配的现代版本）。

`build/build.sh` 参数化：OpenCV tag、白名单路径、`--simd` 开关、`--disable_single_file`。

CI 依次构建 baseline 与 SIMD 两份 wasm，共用同一份 JS glue。

### 9.2 发布

- tag 推送触发 `release.yml`
- 产出物上传至 GitHub Release
- 发布到 npm：`@haoking/opencvjs`
- 附带体积报告（raw / gzip / brotli）与两份 wasm 的测试结果

---

## 10. 分阶段交付

| 阶段  | 内容                                                            | 是否依赖 wasm 重建 |
| ----- | --------------------------------------------------------------- | ------------------ |
| **0** | 根因 A 修复（cvtColor hack → clone）+ 对应测试。以 1.0.0 发布   | 否，可立即交付     |
| **1** | Docker 构建链路 + 白名单 + CI，能稳定产出 4.x baseline wasm     | 是                 |
| **2** | JS 层重写（根因 B/C）+ guards + 完整测试矩阵 + `.d.ts` 自动生成 | 是                 |
| **3** | SIMD 第二份 wasm + 运行时探测 + 体积门禁                        | 是                 |
| **4** | 文档重写（订正全部失实宣称）+ 迁移指南 + 2.0 发布               | 是                 |

阶段 0 独立可交付，让现有用户立刻摆脱 P0 崩溃，无需等待整个重建完成。

**实施计划的拆分**：本 spec 覆盖 5 个阶段，不适合压进单一实施计划。第一个实施计划只覆盖**阶段 0 与阶段 1**——即「先修可立即修的 P0，再打通构建链路」。这两阶段完成后再依据实际产出为阶段 2–4 单独写计划，因为阶段 2 之后的具体做法（白名单能暴露哪些 API、`.d.ts` dump 出什么）取决于阶段 1 的实际构建结果，现在写会是猜测。

---

## 11. 风险与未决项

### 需在实施中实测确认

1. **OpenCV 4.x 最新 tag**：调研中出现 4.13.0（`docs.opencv.org/4.13.0/opencv.js` 返回 200，`@opencvjs/web@4.13.0-release.1` 存在），但 opencv.org/releases 页面停留在 4.12.0。实施时以 GitHub releases API 为准。
2. **`goodFeaturesToTrack` 在 5.x 的存废**：配置文件与运行时 dump 口径冲突。因本项目钉 4.x，暂不影响，但迁移评估时需注意。
3. **`cv.HEAPU8` / `HEAPF32` 在 5.x 是否被移除**：有报告称已移除但未复核。若属实，所有零拷贝像素访问会静默失效。同样因钉 4.x 暂不影响。
4. **2024–2026 无任何 OpenCV.js 的 SIMD 基准数据**，第 1.1 节引用的性能数字均来自 2018–2020。实际收益须在本项目产物上重新测量，尤其要验证 `blur CV_32FC1` 是否仍存在 0.519× 的负收益。

### 已知风险

- **CI 构建时长**：本地不编译意味着构建问题的调试循环较慢。缓解措施是 JS 层完全脱离 wasm 可测，把高频迭代限制在不需要编译的部分。
- **首次构建链路打通的不确定性**：emscripten 编译 OpenCV 环境敏感。阶段 1 单独成阶段即为此——在投入 JS 层重写前先确认构建可复现。
- **上游 API 变动**：官方曾出现 `mat.clone()` 静默退化 12 个月的事故。本项目的测试矩阵与 `.d.ts` 一致性断言即为对此类风险的防御。

---

## 12. 成功标准

1. 第 2 节列出的全部缺陷有对应的失败测试，修复后转绿。
2. 任何人 clone 仓库后，一条命令（或一次 CI 触发）可复现出与 Release 完全一致的产物。
3. README 中每条宣称都有可执行断言背书；无法背书的宣称从 README 中删除。
4. 取区域 / 取列 / 取对角线在全部 7 种深度 × 4 种通道下均不崩溃：阶段 0 验证包装后的 `roi()`/`col()`/`Diag()`，阶段 4 验证撤销覆盖后的 `原生 + .clone()` 路径。两者性能均不劣于 `原生 + clone()` 基准。
5. 产物提供拆分的 `.wasm` 文件与 SIMD 变体——当前生态中无人提供的两项能力。
6. `.d.ts` 与运行时 `Object.keys(cv)` 100% 一致，由 CI 断言保证。
