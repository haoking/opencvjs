# opencvjs 阶段 0 + 阶段 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先修掉 `roi()`/`col()`/`Diag()` 的崩溃与静默错误数据并发布 1.0.1，再打通可复现的 OpenCV 4.x WASM 构建链路。

**Architecture:** 阶段 0 只改现有 `opencv.js` 中三个函数的实现（cvtColor 往返 → `.clone()`），保持 API 形状不变，并建立零依赖的 Node 测试栈。阶段 1 新增 Docker + `build_js.py` 的参数化构建与 GitHub Actions，产出 baseline wasm，但**不**替换 `opencv.js`——替换发生在阶段 2。

**Tech Stack:** Node.js 内置 `node:test` / `node:assert`（零测试依赖）、Docker（`emscripten/emsdk` 官方镜像）、GitHub Actions、Python 3（OpenCV 的 `platforms/js/build_js.py`）。

## Global Constraints

- Node.js **>= 18**（`node:test` 需要）。
- **测试栈零第三方依赖**——只用 `node:test` + `node:assert`。不引入 Jest / Vitest / Mocha。
- emscripten 的 abort **抛出的是数字或字符串，不是 Error 实例**；`e.message` 为 `undefined`。任何捕获点必须经 `test/helpers.js` 的 `describeError(e)` 提取信息——它对数字、字符串、`null`、`undefined`、真 Error 均返回字符串且不抛异常。直接读 `e.message` 并对其做字符串操作会让测试代码自身崩溃，并把这个自伤伪装成「cv 模块报废」。
- 该 abort **可被 try/catch 捕获，捕获后 cv 模块完全正常**（已实测 20 次连续触发）。**不需要子进程隔离。**
- npm 包名 **`@haoking/opencvjs`**（`opencvjs` 与 `opencv-js` 均已被占用）。
- 阶段 0 **保持现有 API 形状**（`roi`/`col` 仍覆盖原生方法）。撤销覆盖属于 2.0，不在本计划内。
- 阶段 1 产出的 wasm **不替换** `opencv.js`。本计划结束时仓库仍以现有 asm.js 为发布产物。
- OpenCV 基线为 **4.x 最新稳定版**，具体 tag 在 Task 7 由 GitHub releases API 确定后写死到构建脚本。
- 编译产物**不提交进 git**（`.gitignore` 覆盖 `dist/`、`build/out/`）。

## 文件结构

| 文件                                | 职责                                             |
| ----------------------------------- | ------------------------------------------------ |
| `package.json`                      | 包元数据、测试脚本、npm 发布白名单               |
| `test/helpers.js`                   | Mat 构造、**独立**计算期望值、安全的异常提取     |
| `test/types/region-ops.test.js`     | 84 个组合（7 深度 × 4 通道 × 3 API）的正确性矩阵 |
| `test/unit/clone-semantics.test.js` | `clone()` 深拷贝断言（防御上游退化）             |
| `test/bench/region-ops.bench.js`    | 性能基准与回归门禁                               |
| `opencv.js`（改 3 处）              | `Diag` / `col` / `roi` 的实现                    |
| `src/config/opencv_js.config.py`    | 模块与函数白名单                                 |
| `build/Dockerfile`                  | 锁死 emsdk 版本                                  |
| `build/build.sh`                    | 参数化构建入口                                   |
| `.github/workflows/ci.yml`          | PR 跑测试                                        |
| `.github/workflows/build-wasm.yml`  | 手动/tag 触发的 wasm 构建                        |
| `test/smoke/wasm-artifact.test.js`  | 新 wasm 产物的冒烟验证                           |

---

# Part A — 阶段 0：修复 + 发布 1.0.1

### Task 1: 测试基础设施

**Files:**

- Create: `package.json`
- Create: `test/helpers.js`
- Create: `.gitignore`

**Interfaces:**

- Consumes: 现有 `opencv.js`（CommonJS 导出 `cv`）
- Produces: `test/helpers.js` 导出 `{ cv, DEPTHS, CHANNELS, describeError, makeMat, expectedRegion, callRegion }`
  - `DEPTHS: string[]` = `['8U','8S','16U','16S','32S','32F','64F']`
  - `CHANNELS: number[]` = `[1,2,3,4]`
  - `describeError(e: unknown): string`
  - `makeMat(depth: string, channels: number): { mat: cv.Mat, data: number[], typeName: string }`
  - `expectedRegion(api: 'roi'|'col'|'diag', data: number[], channels: number): number[]`
  - `callRegion(mat: cv.Mat, api: 'roi'|'col'|'diag'): cv.Mat`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "@haoking/opencvjs",
  "version": "1.0.0",
  "description": "OpenCV for JavaScript with extended Mat operations",
  "main": "opencv.js",
  "scripts": {
    "test": "node --test \"test/**/*.test.js\"",
    "bench": "node test/bench/region-ops.bench.js"
  },
  "files": ["opencv.js", "README.md", "LICENSE"],
  "keywords": ["opencv", "computer-vision", "wasm", "image-processing"],
  "author": "Haochen Wang",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/haoking/opencvjs.git"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
build/out/
*.log
.DS_Store
```

- [ ] **Step 3: 创建 `test/helpers.js`**

```js
"use strict";

const path = require("path");
const cv = require(path.join(__dirname, "..", "opencv.js"));

const DEPTHS = ["8U", "8S", "16U", "16S", "32S", "32F", "64F"];
const CHANNELS = [1, 2, 3, 4];

/**
 * emscripten 在异常被编译掉的构建下抛出的是数字（如 6446944），不是 Error 实例。
 * 直接读 e.message 会得到 undefined，对它做字符串操作会让测试代码自身崩溃，
 * 并把这个自伤伪装成 "cv 模块已报废"。所有捕获点必须走这个函数。
 */
function describeError(e) {
  if (e !== null && typeof e === "object" && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
}

/** 构造 3x3 测试矩阵，值为 1..9*channels，按 OpenCV 交错布局排列。 */
function makeMat(depth, channels) {
  const typeName = `CV_${depth}C${channels}`;
  const type = cv[typeName];
  if (type === undefined) {
    throw new Error(`unknown cv type: ${typeName}`);
  }
  const data = [];
  for (let i = 1; i <= 9 * channels; i += 1) {
    data.push(i);
  }
  return { mat: cv.matFromArray(3, 3, type, data), data, typeName };
}

/**
 * 独立计算期望值 —— 不调用任何被测代码，否则测试会跟着实现一起错。
 * data 为 3x3xC 交错数组，px(r,c) 取该像素的 C 个通道值。
 */
function expectedRegion(api, data, channels) {
  const px = (r, c) =>
    data.slice((r * 3 + c) * channels, (r * 3 + c + 1) * channels);
  if (api === "roi") {
    // Rect(x=1, y=1, w=2, h=2) → 行 1..2 × 列 1..2
    return [...px(1, 1), ...px(1, 2), ...px(2, 1), ...px(2, 2)];
  }
  if (api === "col") {
    return [...px(0, 2), ...px(1, 2), ...px(2, 2)];
  }
  if (api === "diag") {
    return [...px(0, 0), ...px(1, 1), ...px(2, 2)];
  }
  throw new Error(`unknown api: ${api}`);
}

/** 调用被测的区域操作。 */
function callRegion(mat, api) {
  if (api === "roi") return mat.roi(new cv.Rect(1, 1, 2, 2));
  if (api === "col") return mat.col(2);
  if (api === "diag") return mat.Diag();
  throw new Error(`unknown api: ${api}`);
}

module.exports = {
  cv,
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
};
```

- [ ] **Step 4: 验证 helpers 可加载且期望值计算正确**

Run:

```bash
node -e '
const h = require("./test/helpers");
const { data } = h.makeMat("32F", 2);
console.log("data:", data.join(","));
console.log("roi :", h.expectedRegion("roi", data, 2).join(","));
console.log("col :", h.expectedRegion("col", data, 2).join(","));
console.log("diag:", h.expectedRegion("diag", data, 2).join(","));
console.log("desc:", h.describeError(12345), "|", h.describeError(new Error("boom")));
'
```

Expected 逐字输出：

```
data: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18
roi : 9,10,11,12,15,16,17,18
col : 5,6,11,12,17,18
diag: 1,2,9,10,17,18
desc: 12345 | boom
```

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore test/helpers.js
git commit -m "test: 建立零依赖测试基础设施

helpers 提供独立的期望值计算（不调用被测代码），
以及安全的异常提取——emscripten abort 抛的是数字不是 Error，
直接读 .message 会让测试自身崩溃并伪装成模块报废。"
```

---

### Task 2: 区域操作正确性矩阵（失败测试）

**Files:**

- Create: `test/types/region-ops.test.js`

**Interfaces:**

- Consumes: `test/helpers.js` 的全部导出
- Produces: 84 个 `node:test` 用例，命名格式 `` `${api}() on ${typeName}` ``

- [ ] **Step 1: 写测试**

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
} = require("../helpers");

const APIS = ["roi", "col", "diag"];

for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    for (const api of APIS) {
      const typeName = `CV_${depth}C${channels}`;

      test(`${api}() on ${typeName} 返回连续且正确的数据`, () => {
        const { mat, data } = makeMat(depth, channels);
        let out;
        try {
          out = callRegion(mat, api);
        } catch (e) {
          mat.delete();
          assert.fail(`${api}() on ${typeName} 崩溃: ${describeError(e)}`);
        }

        const want = expectedRegion(api, data, channels);
        const got = Array.from(out.DATA());

        assert.strictEqual(
          out.isContinuous(),
          true,
          `${api}() on ${typeName} 返回了非连续 Mat —— .data* 读取会得到错误数据`,
        );
        assert.deepStrictEqual(got, want, `${api}() on ${typeName} 数据错误`);

        mat.delete();
        out.delete();
      });
    }
  }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test 2>&1 | tail -20`

Expected：**不是全绿**。已实测的精确分布是 `# pass 9`、`# fail 75`——84 个组合里只有 9 个正确（`8U`/`16U`/`32F` 三种深度的单通道用例，即 cvtColor 恰好支持的那几种）。75 个失败分两类：

- **12 个崩溃** = `8S`/`16S`/`32S`/`64F`（4 种深度）× 单通道 × 3 个 API。这些走 cvtColor 往返分支，而 cvtColor 只支持 8U/16U/32F，故报 `Exception catching is disabled`。
- **63 个非连续视图** = 全部 7 种深度 × 通道数 2/3/4 × 3 个 API。多通道走「直接返回原生视图」分支，不崩溃，但返回的是非连续 Mat。

  失败信息是 `返回了非连续 Mat —— .data* 读取会得到错误数据`，**不是**数值比对信息——连续性断言排在数据断言之前，63 个用例全部在那里就被拦下，一个都没走到 `deepStrictEqual`（已实测：`返回了非连续 Mat` 命中 63 次，`数据错误` 命中 0 次）。

  这个顺序是有意的：非连续才是根因，数据错误只是它的后果。用户直接读 `.data*` 时才会看到错误数值本身——例如 3×3 `CV_32FC2` 上 `col(2)` 读出 `5,6,7,8,9,10`，正确值是 `5,6,11,12,17,18`。**修复时要解决的是「让返回值连续」，不是「把某处算错的数值改对」。**

失败数远多于崩溃数，正说明多通道的静默错误才是这组缺陷里覆盖面最广的一类。

若出现「全部 84 个失败」或测试进程整体中断，说明 `describeError` 未被正确使用——检查 Step 1 的代码。

- [ ] **Step 3: 提交失败测试**

```bash
git add test/types/region-ops.test.js
git commit -m "test: 区域操作的 84 组类型矩阵（当前失败）

暴露两类缺陷：
- 单通道 8S/16S/32S/64F 走 cvtColor 往返直接崩溃
- 多通道走原生视图分支，不报错但静默返回错误数据"
```

---

### Task 3: 修复 roi / col / Diag

**Files:**

- Modify: `opencv.js`（四处：新增 `cloneAndRelease` helper；改写 `Diag` 约 177-185 行、`col` 约 217-226 行、`roi` 约 301-310 行）

**Interfaces:**

- Consumes: 无
- Produces:
  - `cloneAndRelease(view: cv.Mat): cv.Mat` —— 扩展层内的局部函数（非导出），克隆视图并释放原视图
  - `Mat.prototype.roi(rect)` / `Mat.prototype.col(d)` / `Mat.prototype.Diag(d=0)` 均返回**连续的新 Mat**，对全部 7 种深度 × 4 种通道有效
  - `_roi` / `_col` 仍指向原生实现，保持不变

> ⚠️ **本文档中展示的「原代码」经过 markdown 格式化器改写**（`function(d=0)` 变成
> `function (d = 0)`，缩进由 4 空格变为 2 空格），**与 `opencv.js` 中的实际文本不一致**。
> 直接拿本文的代码块去做字符串匹配会失败。**必须先 Read 实际行，按文件里的真实文本编辑。**

- [ ] **Step 1: 读取三处待改代码的真实文本**

Run:

```bash
grep -n "prototype.Diag = \|prototype._col = \|prototype.col = \|prototype._roi = \|prototype.roi = " opencv.js
```

Expected: 5 行输出，`Diag` 约在 177 行、`_col`/`col` 约 217-218、`_roi`/`roi` 约 301-302。

然后 Read 这三段（各约 10 行）拿到精确文本。**以 Read 的结果为准做编辑，不要用本文档的代码块。**

- [ ] **Step 2: 在扩展层开头插入共享 helper**

在 `OpenCVJSModule.Mat.prototype.DATA = function()` 这一行**之前**插入：

```js
// 原生 roi()/col()/diag() 返回非连续视图，此时 .data* 会按连续内存直读，
// 得到错误数据（3x3 CV_32FC2 上 col(2) 读出 5,6,7,8,9,10，正确值是 5,6,11,12,17,18）。
// 旧实现用 cvtColor(GRAY2BGR→BGR2GRAY) 往返制造连续副本，代价是只支持
// 8U/16U/32F（其余深度直接 abort），且比 clone 慢数倍（实测 roi 7.1x）。
// clone() 正确、更快、支持全部深度，并顺带释放掉此前泄漏的中间 Mat。
function cloneAndRelease(view) {
  const dst = view.clone();
  view.delete();
  return dst;
}
```

- [ ] **Step 3: 用 helper 改写三个函数**

三处**只替换函数体**，`_col` / `_roi` 的赋值行保持不动；`roi` 上方那段已注释掉的旧实现也保持原样。

`Diag`（约 177 行）改为：

```js
OpenCVJSModule.Mat.prototype.Diag = function (d = 0) {
  return cloneAndRelease(this.diag(d));
};
```

`col`（约 218 行，其上一行 `_col` 赋值保留）改为：

```js
OpenCVJSModule.Mat.prototype.col = function (d) {
  return cloneAndRelease(this._col(d));
};
```

`roi`（约 302 行，其上一行 `_roi` 赋值保留）改为：

```js
OpenCVJSModule.Mat.prototype.roi = function (rect) {
  return cloneAndRelease(this._roi(rect));
};
```

三个函数原有的 `if (this.channels() > 1) { return ... }` 分支**全部删除**——多通道走该分支正是静默返回错误数据的根因。

- [ ] **Step 4: 运行测试，确认 84 个全绿**

Run: `npm test 2>&1 | tail -12`

Expected: `# pass 84`、`# fail 0`

- [ ] **Step 5: 提交**

```bash
git add opencv.js
git commit -m "fix: roi/col/Diag 改用 clone 取代 cvtColor 往返

同时解决三个问题：
- 8S/16S/32S/64F 上的 abort（cvtColor 仅支持 8U/16U/32F）
- 多通道路径静默返回错误数据（非连续视图被按连续内存直读）
- 性能退化（实测 roi 提速 7.1x）

并释放此前泄漏的中间 Mat。84 组类型矩阵全绿。"
```

---

### Task 4: clone 深拷贝断言

**Files:**

- Create: `test/unit/clone-semantics.test.js`

**Interfaces:**

- Consumes: `test/helpers.js` 的 `cv`、`makeMat`
- Produces: 无（纯测试）

**背景：** 上游 OpenCV 曾因 [PR #26643](https://github.com/opencv/opencv/pull/26643) 让 `mat.clone()` 静默退化为浅拷贝达约 12 个月。Task 3 的修复完全建立在 `clone()` 之上，因此必须显式断言其语义，而不是假定它正确。

- [ ] **Step 1: 写测试**

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { cv, DEPTHS, CHANNELS, makeMat } = require("../helpers");

// 上游曾让 clone() 静默退化为浅拷贝约 12 个月（opencv PR #26643）。
// 本仓库的 roi/col/Diag 全部建立在 clone() 之上，故必须显式断言。
for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    test(`clone() 对 CV_${depth}C${channels} 是深拷贝`, () => {
      const { mat } = makeMat(depth, channels);
      const copy = mat.clone();

      const before = Array.from(copy.DATA());
      const src = mat.DATA();
      src[0] = src[0] + 100; // 改源

      assert.deepStrictEqual(
        Array.from(copy.DATA()),
        before,
        `clone() 退化为浅拷贝：改源 Mat 后副本跟着变了`,
      );

      mat.delete();
      copy.delete();
    });
  }
}

test("区域操作的返回值不与源 Mat 共享内存", () => {
  const { mat } = makeMat("32F", 1);
  const region = mat.roi(new cv.Rect(1, 1, 2, 2));
  const before = Array.from(region.DATA());

  const src = mat.DATA();
  for (let i = 0; i < src.length; i += 1) src[i] = 0; // 清空源

  assert.deepStrictEqual(
    Array.from(region.DATA()),
    before,
    "roi() 返回值与源共享内存 —— 源被改动后区域数据跟着变了",
  );

  mat.delete();
  region.delete();
});
```

- [ ] **Step 2: 运行，确认通过**

Run: `npm test 2>&1 | tail -8`

Expected: `# fail 0`，用例总数从 84 增至 113（84 + 28 + 1）

- [ ] **Step 3: 提交**

```bash
git add test/unit/clone-semantics.test.js
git commit -m "test: clone 深拷贝断言

上游曾让 clone() 静默退化为浅拷贝 12 个月无人发现，
而本仓库的 roi/col/Diag 全部建立在它之上，不能假定其正确。"
```

---

### Task 5: 性能基准与回归门禁

**Files:**

- Create: `test/bench/region-ops.bench.js`

**Interfaces:**

- Consumes: `test/helpers.js` 的 `cv`
- Produces: 可执行脚本；退出码 0 = 达标，1 = 退化

- [ ] **Step 1: 写基准脚本**

```js
"use strict";

// 修复前的实现比原生 + clone 慢数倍（实测 roi 20000 次：220ms vs 31ms）。
// 该门禁防止未来有人「优化」回 cvtColor 往返那类做法。
const { cv } = require("../helpers");

const N = 20000;
const SIZE = 64;
const RECT = new cv.Rect(1, 1, 32, 32);

function makeBig() {
  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  return cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
}

function timed(label, fn) {
  const mat = makeBig();
  fn(mat); // 预热
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) fn(mat);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  mat.delete();
  console.log(`${label.padEnd(28)} ${ms.toFixed(0)} ms / ${N} 次`);
  return ms;
}

const baseline = timed("原生 _roi + clone (基准)", (m) => {
  const v = m._roi(RECT);
  const d = v.clone();
  v.delete();
  d.delete();
});

const actual = timed("roi() 当前实现", (m) => {
  const d = m.roi(RECT);
  d.delete();
});

// 当前实现就是「原生 + clone」，允许 50% 的测量噪声余量。
const LIMIT = baseline * 1.5;
console.log(`\n阈值: ${LIMIT.toFixed(0)} ms   实测: ${actual.toFixed(0)} ms`);

if (actual > LIMIT) {
  console.error(
    `❌ 性能退化：roi() 比「原生 + clone」慢了 ${(actual / baseline).toFixed(1)}x`,
  );
  process.exit(1);
}
console.log("✅ 性能达标");
```

- [ ] **Step 2: 运行**

Run: `npm run bench`

Expected: 两行耗时相近（当前实现即「原生 + clone」），以 `✅ 性能达标` 结束，退出码 0。

- [ ] **Step 3: 提交**

```bash
git add test/bench/region-ops.bench.js
git commit -m "test: 区域操作性能门禁

防止未来退回 cvtColor 往返那类实现——它比原生 + clone 慢 7.1x。"
```

---

### Task 6: 发布 1.0.1

**Files:**

- Create: `CHANGELOG.md`
- Modify: `package.json`（version）
- Modify: `README.md`（订正失实宣称）

**Interfaces:**

- Consumes: Task 1-5 的全部产出
- Produces: 打上 `v1.0.1` tag 的可发布包

- [ ] **Step 1: 创建 `CHANGELOG.md`**

```markdown
# Changelog

## 1.0.1 — 2026-07-27

### 修复

- **`roi()` / `col()` / `Diag()` 在 `CV_8S` / `CV_16S` / `CV_32S` / `CV_64F` 上崩溃。**
  旧实现用 `cvtColor(GRAY2BGR)` → 操作 → `cvtColor(BGR2GRAY)` 往返来制造连续副本，
  而 `cvtColor` 只支持 8U/16U/32F，其余深度直接 abort。改用 `clone()`。

- **`roi()` / `col()` / `Diag()` 在多通道 Mat 上静默返回错误数据。**
  多通道走的是「直接返回原生视图」分支，视图非连续，`.data*` 会按连续内存直读。
  例：3×3 `CV_32FC2` 上 `col(2)` 返回 `5,6,7,8,9,10`，正确值是 `5,6,11,12,17,18`。
  该缺陷不报错、不崩溃，实际危害高于上一条。

- **性能**：`roi()` 实测提速 7.1×（20000 次 32×32 区域：220ms → 31ms）。

- **内存**：释放 `roi` / `col` / `Diag` 内部此前泄漏的中间 Mat。

### 新增

- 零依赖测试栈（`node:test`），113 个用例，覆盖 7 种深度 × 4 种通道 × 3 个区域操作。
- `clone()` 深拷贝断言与性能回归门禁。

### 文档

- 订正 README 中与实现不符的宣称，详见下方「已知问题」。
```

- [ ] **Step 2: 订正 README 的失实宣称**

在 `README.md` 的 `## Features` 小节中：

1. 删除 `- [x] Some of the bad efficient methods implemented on js encapsulate the c++ method directly by using WebAssembly` —— 当前产物是 asm.js，不是 WebAssembly。
2. 把 `- [x] Every funcation is tested` 改为 `- [x] Region operations (roi/col/Diag) are covered by a 113-case test suite across all 7 depths and 4 channel counts`。
3. 在 `## Features` 之后插入：

```markdown
## Known Issues

以下问题已知存在，修复排期见 `docs/superpowers/specs/2026-07-27-opencvjs-rebuild-design.md`：

- `mds()` 不可用（内部取到函数对象而非数据）。
- `mulSpectrums()` 返回 `NaN`。
- `replaceMatOnPoint()` 的实际签名是 `(value, x, y)`，与本文档中的 `(value, point)` 不符。
- `replaceMatOnRow()` 仅支持 `CV_32F` 类型。
- `reshape(rows)` 覆盖了 OpenCV 原生的 `reshape(cn, rows)` 签名。
- 产物为 asm.js 而非 WebAssembly，基线为 OpenCV 4.0.1。
```

- [ ] **Step 3: 把 `package.json` 的 version 改为 `1.0.1`**

- [ ] **Step 4: 全量验证**

Run:

```bash
npm test 2>&1 | tail -5 && npm run bench 2>&1 | tail -3
```

Expected: `# fail 0` 且 `✅ 性能达标`。**两项都通过才能继续。**

- [ ] **Step 5: 提交并打 tag**

```bash
git add CHANGELOG.md README.md package.json
git commit -m "release: 1.0.1

修复 roi/col/Diag 的崩溃、多通道静默错误数据与性能退化。
订正 README 中与实现不符的宣称，新增已知问题清单。"
git tag -a v1.0.1 -m "1.0.1: 修复区域操作的崩溃与静默错误数据"
```

- [ ] **Step 6: 发布到 npm（需要仓库所有者手动执行）**

首次发布 scoped 包必须显式声明公开，否则 npm 默认按私有包处理并因缺少付费计划而失败。

```bash
npm whoami                      # 未登录则先 npm login
npm publish --access public --dry-run    # 先看将要打包进去的文件清单
```

`--dry-run` 的输出中应**只有** `opencv.js`、`README.md`、`LICENSE`、`package.json` 四项（由 `package.json` 的 `files` 字段限定）。若出现 `test/`、`docs/` 或 `build/`，说明 `files` 字段有误，先修正再继续。

确认无误后：

```bash
npm publish --access public
git push origin rebuild-2.0 --tags
```

**此步骤需要 npm 账号凭据，无法由自动化代理代劳**——若执行者不是仓库所有者，到此为止并向所有者报告 Part A 已就绪待发布。

> Part B 与 Part A 无代码依赖，可独立执行。本部分**不替换** `opencv.js`——只证明能可复现地产出 4.x wasm。

### Task 7: 白名单配置

**Files:**

- Create: `src/config/opencv_js.config.py`
- Create: `build/opencv-version.txt`

**Interfaces:**

- Produces: `src/config/opencv_js.config.py` 供 `build_js.py --config` 使用；`build/opencv-version.txt` 单行记录 OpenCV tag（如 `4.13.0`），被 `build/build.sh` 读取。

- [ ] **Step 1: 确定 OpenCV 4.x 最新稳定 tag**

Run:

```bash
curl -s https://api.github.com/repos/opencv/opencv/releases | \
  grep '"tag_name"' | grep -o '4\.[0-9]*\.[0-9]*' | head -5
```

取输出中最大的 4.x 版本，写入 `build/opencv-version.txt`（单行，无前缀 `v`，例如 `4.13.0`）。

- [ ] **Step 2: 取得上游白名单作为基线**

Run:

```bash
VER=$(cat build/opencv-version.txt)
mkdir -p src/config
curl -sL "https://raw.githubusercontent.com/opencv/opencv/${VER}/platforms/js/opencv_js.config.py" \
  -o src/config/opencv_js.config.py
head -20 src/config/opencv_js.config.py
```

Expected: 文件包含形如 `core = {'': [...], 'Algorithm': []}` 的字典定义，以及末尾的 `white_list = makeWhiteList([...])`。

**不要从零手写此文件** —— 上游格式随版本变化，且函数名必须与该版本的 C++ 签名精确匹配。

- [ ] **Step 3: 裁掉 dnn 模块**

编辑 `src/config/opencv_js.config.py` 末尾的 `makeWhiteList([...])` 调用，从列表中移除 `dnn`。保留 `core`、`imgproc`、`objdetect`、`video`、`features2d`、`photo`、`calib3d`（以该版本文件中实际存在的为准——若某个名字在文件里不存在就跳过它，不要新增）。

在文件顶部加一行注释：

```python
# 相对上游的改动：从 white_list 中移除 dnn（体积大头，含 TensorFlow protobuf）。
# 其余保持与上游同步，便于跟进新版本。
```

- [ ] **Step 4: 验证语法**

Run: `python3 -c "import ast,sys; ast.parse(open('src/config/opencv_js.config.py').read()); print('语法 OK')"`

Expected: `语法 OK`

- [ ] **Step 5: 提交**

```bash
git add src/config/opencv_js.config.py build/opencv-version.txt
git commit -m "build: 白名单配置（基于上游，移除 dnn）

dnn 是当前 13.9MB 产物的体积大头，数据段含 TensorFlow protobuf。
其余保持与上游同步以便跟进新版本。"
```

---

### Task 8: Docker 构建镜像与构建脚本

**Files:**

- Create: `build/Dockerfile`
- Create: `build/build.sh`
- Create: `.dockerignore`

**Interfaces:**

- Consumes: `src/config/opencv_js.config.py`、`build/opencv-version.txt`
- Produces: `build/out/opencv.js` 与 `build/out/opencv.wasm`（`--disable_single_file` 下为两个文件）

- [ ] **Step 1: 创建 `.dockerignore`**

```
.git
node_modules
build/out
dist
opencv.js
```

- [ ] **Step 2: 创建 `build/Dockerfile`**

```dockerfile
# 锁死 emsdk 版本 —— 官方 nightly 仍钉在 2019 年的 1.39.0，不可参照。
# 升级此版本号时必须重跑 Task 10 的冒烟测试。
FROM emscripten/emsdk:3.1.64

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 git cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
```

- [ ] **Step 3: 创建 `build/build.sh`**

```bash
#!/usr/bin/env bash
# 在 emsdk 容器内构建 OpenCV.js。宿主机不需要任何工具链。
#
# 用法: build/build.sh [--simd]
#
# 产物: build/out/opencv.js + build/out/opencv.wasm
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCV_VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/build/opencv-version.txt")"
IMAGE_TAG="opencvjs-build:${OPENCV_VERSION}"
OUT_DIR="${REPO_ROOT}/build/out"

SIMD_FLAG=""
BUILD_SUBDIR="baseline"
if [[ "${1:-}" == "--simd" ]]; then
  SIMD_FLAG="--simd"
  BUILD_SUBDIR="simd"
fi

echo "==> OpenCV ${OPENCV_VERSION}, 变体: ${BUILD_SUBDIR}"

docker build -t "${IMAGE_TAG}" -f "${REPO_ROOT}/build/Dockerfile" "${REPO_ROOT}"

mkdir -p "${OUT_DIR}/${BUILD_SUBDIR}"

docker run --rm \
  -v "${REPO_ROOT}/src/config:/config:ro" \
  -v "${OUT_DIR}/${BUILD_SUBDIR}:/out" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c "
    git clone --depth 1 --branch ${OPENCV_VERSION} https://github.com/opencv/opencv.git /work/opencv
    cd /work/opencv
    python3 ./platforms/js/build_js.py /work/build_js \
      --build_wasm \
      --disable_single_file \
      --config /config/opencv_js.config.py \
      --emscripten_dir \$EMSDK/upstream/emscripten \
      ${SIMD_FLAG}
    cp /work/build_js/bin/opencv.js  /out/
    cp /work/build_js/bin/opencv.wasm /out/
  "

echo "==> 产物:"
ls -la "${OUT_DIR}/${BUILD_SUBDIR}"
```

- [ ] **Step 4: 加可执行权限并验证脚本语法**

Run:

```bash
chmod +x build/build.sh
bash -n build/build.sh && echo "语法 OK"
```

Expected: `语法 OK`

- [ ] **Step 5: 提交**

```bash
git add build/Dockerfile build/build.sh .dockerignore
git commit -m "build: Docker 化的参数化构建

锁死 emsdk 版本保证可复现。默认启用 --disable_single_file——
现有生态（含官方）全部把 wasm 以 base64 内联进 JS，
膨胀 33% 且强制按 JS 字符串解析而非流式编译。"
```

---

### Task 9: CI 工作流（PR 跑测试）

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `package.json` 的 `test` 与 `bench` 脚本
- Produces: 每个 PR 与 push 上的测试门禁

- [ ] **Step 1: 写工作流**

```yaml
name: CI

on:
  push:
    branches: [master, rebuild-2.0]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ["18", "20", "22"]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      # 测试栈零依赖，无需 npm install

      - name: 运行测试
        run: npm test

      - name: 性能门禁
        # 只在一个 Node 版本上跑，避免 CI runner 抖动导致误报
        if: matrix.node == '22'
        run: npm run bench
```

- [ ] **Step 2: 本地模拟 CI 步骤**

Run: `npm test 2>&1 | tail -5 && npm run bench 2>&1 | tail -3`

Expected: `# fail 0` 且 `✅ 性能达标`

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: PR 与 push 上的测试门禁

Node 18/20/22 三版本跑测试；性能门禁只在 22 上跑，
避免 CI runner 抖动造成误报。"
```

---

### Task 10: wasm 构建工作流与产物冒烟测试

**Files:**

- Create: `.github/workflows/build-wasm.yml`
- Create: `test/smoke/wasm-artifact.test.js`

**Interfaces:**

- Consumes: `build/build.sh`、`build/opencv-version.txt`
- Produces: GitHub Actions artifact `opencv-wasm-baseline`，含 `opencv.js` + `opencv.wasm`

- [ ] **Step 1: 写冒烟测试**

```js
"use strict";

// 验证新构建的 wasm 产物可用。通过环境变量 OPENCV_ARTIFACT 指向待测产物，
// 未设置时跳过——这样它在常规 npm test 中不会因找不到产物而失败。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const artifact = process.env.OPENCV_ARTIFACT;

test(
  "新构建的 wasm 产物冒烟验证",
  { skip: !artifact ? "未设置 OPENCV_ARTIFACT" : false },
  async () => {
    const jsPath = path.resolve(artifact, "opencv.js");
    const wasmPath = path.resolve(artifact, "opencv.wasm");

    assert.ok(fs.existsSync(jsPath), `缺少 ${jsPath}`);
    assert.ok(
      fs.existsSync(wasmPath),
      `缺少 ${wasmPath} —— --disable_single_file 未生效？`,
    );

    const jsSize = fs.statSync(jsPath).size;
    assert.ok(
      jsSize < 2 * 1024 * 1024,
      `opencv.js 有 ${(jsSize / 1048576).toFixed(1)}MB —— wasm 可能仍被 base64 内联进了 JS`,
    );

    const mod = require(jsPath);
    const cv = typeof mod.then === "function" ? await mod : mod;
    if (typeof cv.onRuntimeInitialized === "function" || !cv.Mat) {
      await new Promise((resolve) => {
        cv.onRuntimeInitialized = resolve;
      });
    }

    // 基本可用性
    const m = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
    assert.strictEqual(m.rows, 2);
    assert.deepStrictEqual(Array.from(m.data32F), [1, 2, 3, 4]);

    // clone 必须是深拷贝 —— 上游曾让它静默退化为浅拷贝 12 个月。
    // 每次换 OpenCV 版本都要重验，不能假定。
    const copy = m.clone();
    m.data32F[0] = 999;
    assert.strictEqual(copy.data32F[0], 1, "clone() 退化为浅拷贝");

    // 白名单必须保住 CascadeClassifier（5.x 移除了它，这是钉 4.x 的理由）
    assert.ok(
      typeof cv.CascadeClassifier === "function",
      "白名单丢失 CascadeClassifier",
    );

    // dnn 应已被裁掉
    assert.strictEqual(cv.readNetFromTensorflow, undefined, "dnn 未被裁掉");

    m.delete();
    copy.delete();
  },
);
```

- [ ] **Step 2: 写构建工作流**

```yaml
name: Build WASM

on:
  workflow_dispatch:
  push:
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: 构建 baseline wasm
        run: ./build/build.sh

      - name: 报告体积
        run: |
          cd build/out/baseline
          for f in opencv.js opencv.wasm; do
            raw=$(stat -c%s "$f")
            gz=$(gzip -c "$f" | wc -c)
            br=$(brotli -c "$f" | wc -c)
            printf '%-14s raw %8s  gzip %8s  brotli %8s\n' "$f" "$raw" "$gz" "$br"
          done

      - name: 冒烟测试
        env:
          OPENCV_ARTIFACT: ${{ github.workspace }}/build/out/baseline
        run: node --test "test/smoke/*.test.js"

      - uses: actions/upload-artifact@v4
        with:
          name: opencv-wasm-baseline
          path: build/out/baseline/
          retention-days: 30
```

- [ ] **Step 3: 确认冒烟测试在无产物时被跳过**

Run: `node --test "test/smoke/*.test.js" 2>&1 | tail -6`

Expected: `# skipped 1`、`# fail 0`（未设 `OPENCV_ARTIFACT` 时应跳过而非失败）

- [ ] **Step 4: 确认整套测试仍全绿**

Run: `npm test 2>&1 | tail -6`

Expected: `# fail 0`

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/build-wasm.yml test/smoke/wasm-artifact.test.js
git commit -m "ci: wasm 构建工作流与产物冒烟测试

冒烟测试断言四件事：wasm 已拆分为独立文件、clone 是深拷贝、
CascadeClassifier 仍在（钉 4.x 的理由）、dnn 已裁掉。"
```

- [ ] **Step 6: 手动触发首次构建**

推送分支后，在 GitHub Actions 页面手动触发 `Build WASM`（`workflow_dispatch`）。

**这是阶段 1 的真正验收点。** 首次构建预期耗时 60–150 分钟，且很可能失败——常见原因与处置：

| 症状                                                                | 处置                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `build_js.py: error: unrecognized arguments: --disable_single_file` | 该版本不支持此选项，从 `build/build.sh` 中移除并在 `build/opencv-version.txt` 旁记录 |
| 白名单里某函数在该版本不存在                                        | 从 `src/config/opencv_js.config.py` 中删除该条目                                     |
| 超出 180 分钟超时                                                   | 提高 `timeout-minutes`，或在 Dockerfile 中预装依赖以缩短                             |
| 冒烟测试报 `wasm 可能仍被 base64 内联`                              | 确认 `--disable_single_file` 确实生效                                                |

构建成功且冒烟测试通过后，阶段 1 完成。

---

## 完成标准

**Part A（阶段 0）：**

1. `npm test` 输出 `# fail 0`，用例数 113。
2. `npm run bench` 以 `✅ 性能达标` 结束，退出码 0。
3. `v1.0.1` tag 已打。
4. README 中不再有与实现不符的宣称，且带「Known Issues」清单。

**Part B（阶段 1）：** 5. `Build WASM` 工作流成功产出 `opencv.js` + **独立的** `opencv.wasm`。6. 冒烟测试四项断言全过：文件已拆分、`clone()` 深拷贝、`CascadeClassifier` 在、`dnn` 已裁。7. 体积报告已记录（raw / gzip / brotli），作为后续 SIMD 变体与阶段 2 的对比基准。

## 不在本计划内

以下属于阶段 2-4，需在阶段 1 实际产出后另行制定计划——因为具体做法取决于构建出的产物实际暴露了哪些 API：

- 用新 wasm 替换 `opencv.js`
- 根因 B（白名单放行 `mmul`/`svd`/`Rodrigues`/`mulSpectrums` 等）与根因 C 的修复
- `guards.js` 参数前置校验（spec 第 8.1 节）
- SIMD 第二份 wasm 与运行时探测（spec 决策 8）
- `.d.ts` 自动生成与运行时一致性断言（spec 第 8.3 节）
- 撤销对原生方法的覆盖（spec 第 6.2/6.3 节的 2.0 breaking changes）
- **README 示例抽取为可执行断言**（spec 第 7.3 节）——本计划只在 Task 6 中订正失实宣称并加「已知问题」清单，示例转测试需等根因 B/C 修完，否则会把当前的错误期望值（如 `mulSpectrums` 的 `NaN`）固化进测试
- **gzip / brotli 体积回归门禁**（spec 第 7.4 节）——Task 10 只产出首份体积报告作为基准，有了基准之后才谈得上门禁
