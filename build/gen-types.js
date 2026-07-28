#!/usr/bin/env node
"use strict";

/**
 * 从**组装后的 dist/ 产物本身**生成 dist/index.d.ts。
 *
 * 用法: node build/gen-types.js [dist 目录]      （默认 ./dist，也认 OPENCV_DIST）
 * 由 build/assemble.sh 在组装的最后一步自动调用。
 *
 * ── 为什么不手写 ──────────────────────────────────────────────────────────
 * 生态里现有的 OpenCV.js 类型声明（@opencvjs/types、TechStark 的 src/）**与运行时
 * 不符**：声明了运行时并不存在的 SIFT / PCA / FlannBasedMatcher，又漏掉了确实存在的
 * FaceDetectorYN。血统能追到 2019 年的 mirada，此后一直靠人手维护。后果是最难受的
 * 那一种——代码通过类型检查，然后运行时抛异常。
 *
 * 手写声明一定会漂移，因为它和产物之间没有任何机械联系：白名单改一行、embind 的
 * 重载分发规则变一点，声明都不会自己跟着动。本项目手里有产物，所以可以不猜：
 * 顶层符号集直接取自 `Object.keys(cv)`，Mat 成员取自其原型链。
 *
 * ── 这份声明保证什么、不保证什么 ──────────────────────────────────────────
 * 保证：**声明的符号集与运行时的符号集严格相等**（双向，由
 *   test/types/dts-consistency.test.js 断言；那条断言是这件事的全部意义）。
 * 不保证：每个原生函数的参数类型精确。要做到那一步得解析 OpenCV 的 C++ 签名并复现
 *   embind 的重载分发规则，超出本项目范围——所以未逐条标注的原生绑定一律是
 *   `(...args: any[]): any`。**宁可说得少，也不说错**：多一个不存在的符号，害处比
 *   少一个 any 大得多，这正是现有生态那几份 .d.ts 栽的地方。
 * 例外：本项目自己写的扩展层（roiClone / DATA / PTR / replaceMatOn* 等）给出准确
 *   签名——那些是我们自己的代码，签名有据可依。
 *
 * ⚠️ 不要手改 dist/index.d.ts：dist/ 每次 assemble 都会整个重建。要改签名，改本文件
 *    下面的 CV_SIGNATURES / MAT_SIGNATURES。
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// 手写签名表。
//
// 表里的每个名字都必须真实存在于运行时，否则生成直接失败（见 checkKnown）——
// 手写的那一半同样不许漂移。
// ---------------------------------------------------------------------------

/** cv 顶层：本项目的扩展、glue 的值类型构造器、以及几个已实测的成员。 */
const CV_SIGNATURES = {
  Mat: "Mat: MatConstructor;",
  matFromArray:
    "matFromArray(rows: number, cols: number, type: number, array: ArrayLike<number>): Mat;",
  norm2: "norm2(src1: Mat, src2: Mat, normType?: number): number;",
  Rect: "Rect: RectConstructor;",
  Point: "Point: PointConstructor;",
  Size: "Size: SizeConstructor;",
  Scalar: "Scalar: ScalarConstructor;",
  Range: "Range: RangeConstructor;",
  RotatedRect: "RotatedRect: RotatedRectConstructor;",
  TermCriteria: "TermCriteria: TermCriteriaConstructor;",
  MinMaxLoc: "MinMaxLoc: MinMaxLocConstructor;",
  Circle: "Circle: CircleConstructor;",
  HEAP8: "HEAP8: Int8Array;",
  HEAPU8: "HEAPU8: Uint8Array;",
  HEAP16: "HEAP16: Int16Array;",
  HEAPU16: "HEAPU16: Uint16Array;",
  HEAP32: "HEAP32: Int32Array;",
  HEAPU32: "HEAPU32: Uint32Array;",
  HEAPF32: "HEAPF32: Float32Array;",
  HEAPF64: "HEAPF64: Float64Array;",
};

/**
 * Mat 成员。
 *
 * 扩展层（DATA 起往下）是本项目自己的代码，签名准确。上面那批原生成员的返回值
 * 全部在本产物上实测过（3×3 CV_32FC2）：size() 得 {width, height}，matSize/step 是
 * 普通数组，row/col/diag/roi/t/rowRange/colRange/clone 得 Mat，create() 返回
 * undefined。其余原生方法一律留给 `(...args: any[]): any`。
 */
const MAT_SIGNATURES = {
  // —— embind 的对象生命周期（挂在 ClassHandle.prototype 上，不在 Mat.prototype 上）——
  delete: "delete(): void;",
  isDeleted: "isDeleted(): boolean;",
  deleteLater: "deleteLater(): this;",
  isAliasOf: "isAliasOf(other: unknown): boolean;",
  // —— 原生绑定中已实测的部分 ——
  rows: "rows: number;",
  cols: "cols: number;",
  matSize: "matSize: number[];",
  step: "step: number[];",
  data: "data: Uint8Array;",
  data8S: "data8S: Int8Array;",
  data16U: "data16U: Uint16Array;",
  data16S: "data16S: Int16Array;",
  data32S: "data32S: Int32Array;",
  data32F: "data32F: Float32Array;",
  data64F: "data64F: Float64Array;",
  type: "type(): number;",
  depth: "depth(): number;",
  channels: "channels(): number;",
  total: "total(): number;",
  elemSize: "elemSize(): number;",
  elemSize1: "elemSize1(): number;",
  step1: "step1(i: number): number;",
  empty: "empty(): boolean;",
  isContinuous: "isContinuous(): boolean;",
  size: "size(): Size;",
  clone: "clone(): Mat;",
  mat_clone: "mat_clone(): Mat;",
  t: "t(): Mat;",
  row: "row(y: number): Mat;",
  col: "col(x: number): Mat;",
  diag: "diag(d?: number): Mat;",
  roi: "roi(rect: Rect): Mat;",
  rowRange: "rowRange(start: number, end: number): Mat;",
  colRange: "colRange(start: number, end: number): Mat;",
  create: "create(rows: number, cols: number, type: number): void;",
  // —— 本项目的扩展层 ——
  DATA: "DATA(): MatTypedArray;",
  PTR: "PTR(row: number, col?: number): MatTypedArray;",
  roiClone: "roiClone(rect: Rect): Mat;",
  colClone: "colClone(col: number): Mat;",
  diagClone: "diagClone(d?: number): Mat;",
  replaceMatOnRect: "replaceMatOnRect(src: Mat, rect: Rect): void;",
  replaceMatOnRow:
    "replaceMatOnRow(arr: ArrayLike<number>, row: number): void;",
  replaceMatOnCol:
    "replaceMatOnCol(arr: ArrayLike<number>, col: number): void;",
  replaceMatOnPoint:
    "replaceMatOnPoint(value: number, rowOrPoint: number | Point, col?: number): void;",
  addOnCol: "addOnCol(constant: number, col: number): void;",
  rectAdd: "rectAdd(src: Mat, rect: Rect): void;",
  rectSubtract: "rectSubtract(src: Mat, rect: Rect): void;",
  addConstant: "addConstant(constant: number): Mat;",
  constantSubtract: "constantSubtract(constant: number): Mat;",
  mulConstant: "mulConstant(constant: number): Mat;",
  constantDivide: "constantDivide(constant: number): Mat;",
  sum: "sum(): number;",
  reshapeRows: "reshapeRows(rows: number): Mat;",
  dftSplit: "dftSplit(): { r: Mat; i: Mat };",
};

// 生成区块的标记。test/types/dts-consistency.test.js 用它们框出「声明的符号集」，
// 因此格式必须保持「一行一个符号」。
const CV_BEGIN = "// #region generated:cv";
const CV_END = "// #endregion generated:cv";
const MAT_BEGIN = "// #region generated:Mat";
const MAT_END = "// #endregion generated:Mat";

/**
 * Mat 实例上所有自有可枚举成员。
 *
 * 必须走整条原型链：`delete` / `isDeleted` / `deleteLater` / `isAliasOf` 挂在 embind 的
 * ClassHandle.prototype 上，不在 Mat.prototype 上。只 dump Object.keys(cv.Mat.prototype)
 * 会漏掉它们，而 `mat.delete()` 出现在本项目**每一个**示例里——漏掉即等于让 TS 用户
 * 的每个示例都报错。
 */
function dumpMatMembers(MatCtor) {
  const names = new Set();
  let proto = MatCtor.prototype;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.keys(proto)) names.add(key);
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

/** 沿原型链找到某个成员的属性描述符（用于区分访问器与方法）。 */
function findDescriptor(MatCtor, name) {
  let proto = MatCtor.prototype;
  while (proto && proto !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

/** 手写表里的名字必须都存在于运行时，否则就是又一份会说谎的声明。 */
function checkKnown(table, actual, what) {
  const missing = Object.keys(table).filter((k) => !actual.includes(k));
  if (missing.length > 0) {
    throw new Error(
      `${what} 的手写签名表里有运行时不存在的符号: ${missing.join(", ")}\n` +
        `——这正是本文件开头描述的那种失败。请删掉它们，或确认产物是否已变。`,
    );
  }
}

/**
 * 所有符号名都必须是合法的 JS 标识符。
 *
 * 本产物实测全部合法（1450 + 75 个，无一例外）。这里显式挡一道，是因为一旦出现
 * 带连字符之类的名字，下面会原样吐出 `foo-bar: number;` —— 那是**无效的 TS**，而
 * 本仓库不带 TypeScript 依赖、CI 也不做类型检查，没人会发现。宁可在生成这一步炸掉，
 * 也不要发布一份编译不过的声明。真出现了，就在这里改成给名字加引号（并同步
 * test/types/dts-consistency.test.js 的解析正则）。
 */
function checkIdentifiers(names, what) {
  const bad = names.filter((n) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
  if (bad.length > 0) {
    throw new Error(
      `${what} 里有不是合法标识符的符号名: ${bad.join(", ")}\n` +
        `——原样输出会生成无效的 TS。需要给这些名字加引号，见本函数的注释。`,
    );
  }
}

/** 一个 cv 顶层成员的自动声明（按运行时 typeof 定型）。 */
function autoCvMember(name, value) {
  switch (typeof value) {
    case "number":
      return `readonly ${name}: number;`;
    case "boolean":
      return `readonly ${name}: boolean;`;
    case "string":
      return `readonly ${name}: string;`;
    case "undefined":
      return `readonly ${name}: undefined;`;
    case "function":
      return `${name}: OpenCVBinding;`;
    default:
      return `${name}: any;`;
  }
}

/** 一个 Mat 成员的自动声明。 */
function autoMatMember(MatCtor, name) {
  const desc = findDescriptor(MatCtor, name);
  if (desc && typeof desc.value === "function") {
    return `${name}(...args: any[]): any;`;
  }
  return `${name}: any;`;
}

/** 渲染整份 .d.ts。 */
function render(cv) {
  const cvKeys = Object.keys(cv).sort();
  const matKeys = dumpMatMembers(cv.Mat).sort();

  checkKnown(CV_SIGNATURES, cvKeys, "cv 顶层");
  checkKnown(MAT_SIGNATURES, matKeys, "Mat 成员");
  checkIdentifiers(cvKeys, "cv 顶层");
  checkIdentifiers(matKeys, "Mat 成员");

  const known = (keys, table) => keys.filter((k) => table[k] !== undefined);
  const auto = (keys, table) => keys.filter((k) => table[k] === undefined);

  const lines = [];
  const push = (indent, text) =>
    lines.push(text ? " ".repeat(indent) + text : "");

  push(
    0,
    "// 本文件由 build/gen-types.js 从组装后的 dist/ 产物自动生成 —— 请勿手改。",
  );
  push(
    0,
    "// 重新生成: npm run assemble（或 node build/gen-types.js [dist 目录]）",
  );
  push(0, "//");
  push(
    0,
    "// 顶层符号取自运行时的 Object.keys(cv)，Mat 成员取自 Mat 实例的整条原型链，",
  );
  push(
    0,
    "// 因此这里声明的每一个符号都确实存在、每一个存在的符号也都被声明——两个方向都由",
  );
  push(
    0,
    "// test/types/dts-consistency.test.js 断言。生态里几份手写的 OpenCV.js 声明正是在",
  );
  push(
    0,
    "// 这一点上失守：声明了运行时没有的 SIFT / PCA / FlannBasedMatcher，又漏掉了确实",
  );
  push(0, "// 存在的 FaceDetectorYN，于是代码能过类型检查、运行时才抛异常。");
  push(0, "//");
  push(
    0,
    "// 未逐条标注签名的原生绑定一律是 (...args: any[]): any —— 精确到每个参数需要解析",
  );
  push(
    0,
    "// OpenCV 的 C++ 签名并复现 embind 的重载分发，超出本项目范围。本项目自己写的扩展层",
  );
  push(0, "// 有准确签名。");
  push(0, "");
  push(0, `// 符号数: cv 顶层 ${cvKeys.length}，Mat 成员 ${matKeys.length}`);
  push(0, "");
  push(
    0,
    "declare function loadOpenCV(options?: loadOpenCV.LoadOptions): Promise<loadOpenCV.CV>;",
  );
  push(0, "");
  push(0, "declare namespace loadOpenCV {");

  push(2, "/** loadOpenCV() 的可选参数。 */");
  push(2, "interface LoadOptions {");
  push(4, "/**");
  push(
    4,
    " * 强制选择 wasm 变体。缺省时按 WebAssembly SIMD 运行时探测自动选择",
  );
  push(4, " * （环境变量 OPENCV_SIMD 的优先级介于两者之间）。");
  push(4, " *");
  push(4, " * 明确指定的变体若不存在会**抛错**，不会悄悄回落到另一个——那会让");
  push(4, " * 「强制某变体跑一遍」变成谎报。");
  push(4, " */");
  push(4, "simd?: boolean;");
  push(2, "}");
  push(0, "");
  push(2, "/**");
  push(2, " * 当前运行时是否支持 WebAssembly SIMD。");
  push(2, " *");
  push(
    2,
    " * 只反映引擎能力，不反映最终加载了哪个变体：OPENCV_SIMD=0 时引擎照样",
  );
  push(2, " * 支持 SIMD，但加载的是 baseline。");
  push(2, " */");
  push(2, "function detectSimd(): boolean;");
  push(0, "");
  push(2, "/** 未逐条标注签名的原生绑定：既可当函数调用，也可当类 new。 */");
  push(2, "interface OpenCVBinding {");
  push(4, "(...args: any[]): any;");
  push(4, "new (...args: any[]): any;");
  push(2, "}");
  push(0, "");
  push(2, "/** DATA() / PTR() 按 Mat 的 depth() 分发到的 TypedArray。 */");
  push(
    2,
    "type MatTypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Int32Array | Float32Array | Float64Array;",
  );
  push(0, "");

  // glue 里的值类型（纯 JS 类，构造器重载逐条对着 dist/opencv.js 的实现写）
  for (const block of [
    [
      "/** cv.Point —— glue 里的纯 JS 类，缺省分量为 0。 */",
      "interface Point { x: number; y: number; }",
      "interface PointConstructor { new (x?: number, y?: number): Point; }",
    ],
    [
      "/** cv.Size —— glue 里的纯 JS 类，缺省分量为 0。 */",
      "interface Size { width: number; height: number; }",
      "interface SizeConstructor { new (width?: number, height?: number): Size; }",
    ],
    [
      "/** cv.Rect —— 接受 0 / 1（另一个 Rect）/ 2（Point + Size）/ 4 个参数。 */",
      "interface Rect { x: number; y: number; width: number; height: number; }",
      "interface RectConstructor {",
      "  new (): Rect;",
      "  new (rect: Rect): Rect;",
      "  new (point: Point, size: Size): Rect;",
      "  new (x: number, y: number, width: number, height: number): Rect;",
      "}",
    ],
    [
      "/** cv.Range —— glue 里的纯 JS 类。 */",
      "interface Range { start: number; end: number; }",
      "interface RangeConstructor { new (start?: number, end?: number): Range; }",
    ],
    [
      "/**",
      " * cv.Scalar —— 原型是一个 Array 实例，四个分量缺省为 0。",
      " *",
      " * ⚠️ 静态方法 cv.Scalar.all(v) 在 glue 里写成 `return Scalar(v, v, v, v)`（漏了 new），",
      " * 调用即抛 `TypeError: this.push is not a function`。这里照实声明它存在，但别用。",
      " */",
      "interface Scalar extends Array<number> {}",
      "interface ScalarConstructor {",
      "  new (v0?: number, v1?: number, v2?: number, v3?: number): Scalar;",
      "  all(v: number): Scalar;",
      "}",
    ],
    [
      "/** cv.RotatedRect —— 接受 0 或 3 个参数。 */",
      "interface RotatedRect { center: Point; size: Size; angle: number; }",
      "interface RotatedRectConstructor {",
      "  new (): RotatedRect;",
      "  new (center: Point, size: Size, angle: number): RotatedRect;",
      "  points(obj: RotatedRect): Point[];",
      "  boundingRect(obj: RotatedRect): Rect;",
      "  boundingRect2f(obj: RotatedRect): Rect;",
      "}",
    ],
    [
      "/** cv.TermCriteria —— 接受 0 或 3 个参数。 */",
      "interface TermCriteria { type: number; maxCount: number; epsilon: number; }",
      "interface TermCriteriaConstructor {",
      "  new (): TermCriteria;",
      "  new (type: number, maxCount: number, epsilon: number): TermCriteria;",
      "}",
    ],
    [
      "/**",
      " * cv.MinMaxLoc —— 接受 0 或 4 个参数。",
      " *",
      " * ⚠️ minLoc / maxLoc 带上 undefined 不是保守起见：0 参构造器在 glue 里写的是",
      " * `this.minLoc = Point(0, 0)`，漏了 new，于是 `new cv.MinMaxLoc().minLoc` 实测",
      " * 就是 undefined。与 cv.Scalar.all 是同一类 glue 缺陷。4 参构造器正常。",
      " */",
      "interface MinMaxLoc { minVal: number; maxVal: number; minLoc: Point | undefined; maxLoc: Point | undefined; }",
      "interface MinMaxLocConstructor {",
      "  new (): MinMaxLoc;",
      "  new (minVal: number, maxVal: number, minLoc: Point, maxLoc: Point): MinMaxLoc;",
      "}",
    ],
    [
      "/**",
      " * cv.Circle —— 接受 0 或 2 个参数。",
      " *",
      " * ⚠️ center 带上 undefined 的理由同 MinMaxLoc：0 参构造器里的 `Point(0, 0)` 漏了",
      " * new，`new cv.Circle().center` 实测是 undefined。",
      " */",
      "interface Circle { center: Point | undefined; radius: number; }",
      "interface CircleConstructor {",
      "  new (): Circle;",
      "  new (center: Point, radius: number): Circle;",
      "}",
    ],
    [
      "/**",
      " * cv.Mat 的构造器。",
      " *",
      " * ⚠️ embind **只按参数个数分发**，所以每个参数个数上只有一个签名。下面这五个是",
      " * 实测存在的全部：0 参、1 参（拷贝构造）、2 参（Size + type）、3 参（rows + cols +",
      " * type）、4 参（再加 Scalar）。特别注意**没有** (Size, type, Scalar) —— 那是 3 个",
      " * 参数，会被分发到 (rows, cols, type)，实测静默得到一个 0×5 的畸形 Mat 而不报错。",
      " *",
      " * ⚠️ 本产物**没有** Symbol.dispose（实测 Mat 原型链上没有任何 symbol 属性），",
      " * 所以不能用 TS 5.2 的 `using`。Mat 一律由调用方显式 delete()。",
      " */",
      "interface MatConstructor {",
      "  new (): Mat;",
      "  new (mat: Mat): Mat;",
      "  new (size: Size, type: number): Mat;",
      "  new (rows: number, cols: number, type: number): Mat;",
      "  new (rows: number, cols: number, type: number, fillValue: Scalar): Mat;",
      "  zeros(rows: number, cols: number, type: number): Mat;",
      "  ones(rows: number, cols: number, type: number): Mat;",
      "  eye(rows: number, cols: number, type: number): Mat;",
      "  readonly argCount: number | undefined;",
      "}",
    ],
  ]) {
    for (const line of block) push(2, line);
    push(0, "");
  }

  // ── Mat 成员 ──
  push(2, "interface Mat {");
  push(4, MAT_BEGIN);
  push(4, "// 本项目的扩展层与已实测的原生成员（准确签名）");
  for (const name of known(matKeys, MAT_SIGNATURES)) {
    push(4, MAT_SIGNATURES[name]);
  }
  const autoMat = auto(matKeys, MAT_SIGNATURES);
  if (autoMat.length > 0) {
    push(0, "");
    push(4, "// 其余原生绑定（存在性来自运行时，签名未逐条标注）");
    for (const name of autoMat) push(4, autoMatMember(cv.Mat, name));
  }
  push(4, MAT_END);
  push(2, "}");
  push(0, "");

  // ── cv 顶层 ──
  push(2, "/** await loadOpenCV() 之后拿到的 cv 对象。 */");
  push(2, "interface CV {");
  push(4, CV_BEGIN);
  push(4, "// 准确签名");
  for (const name of known(cvKeys, CV_SIGNATURES)) {
    push(4, CV_SIGNATURES[name]);
  }
  push(0, "");
  push(
    4,
    "// 其余符号（存在性来自运行时 Object.keys(cv)，按 typeof 自动定型）",
  );
  for (const name of auto(cvKeys, CV_SIGNATURES)) {
    push(4, autoCvMember(name, cv[name]));
  }
  push(4, CV_END);
  push(2, "}");
  push(0, "}");
  push(0, "");
  push(0, "export = loadOpenCV;");
  push(0, "");

  return lines.join("\n");
}

async function main() {
  const distDir = path.resolve(
    process.argv[2] ||
      process.env.OPENCV_DIST ||
      path.join(__dirname, "..", "dist"),
  );
  const entry = path.join(distDir, "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到 ${entry} —— 先跑 build/assemble.sh`);
  }
  // 固定用 baseline 变体生成（{ simd: false }，而不是靠环境变量——手动跑本脚本
  // 时没人会记得设）。声明只有一份，而它必须同时描述两个变体；来源必须确定，
  // 否则同一份源码在装了/没装 SIMD 产物的机器上会生成不同的 .d.ts。
  // 两个变体的 API 面是否一致由测试来对：CI 带 OPENCV_SIMD=1 再跑一遍整套测试，
  // 其中 test/types/dts-consistency.test.js 会拿 SIMD 运行时的符号集来对这份声明。
  const cv = await require(entry)({ simd: false });
  if (typeof cv.Mat !== "function") {
    throw new Error("cv.Mat 不是构造函数 —— wasm 运行时未就绪");
  }
  const out = path.join(distDir, "index.d.ts");
  fs.writeFileSync(out, render(cv));
  const cvCount = Object.keys(cv).length;
  const matCount = dumpMatMembers(cv.Mat).length;
  console.log(
    `==> ${out}（cv 顶层 ${cvCount} 个符号，Mat 成员 ${matCount} 个）`,
  );
}

module.exports = {
  render,
  dumpMatMembers,
  CV_BEGIN,
  CV_END,
  MAT_BEGIN,
  MAT_END,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ 生成 .d.ts 失败: ${(e && e.message) || e}`);
    process.exit(1);
  });
}
