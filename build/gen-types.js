#!/usr/bin/env node
"use strict";

/**
 * Generates dist/index.d.ts from **the assembled dist/ artifacts themselves**.
 *
 * Usage: node build/gen-types.js [dist dir]      (defaults to ./dist; OPENCV_DIST works too)
 * build/assemble.sh runs it as the last assembly step.
 *
 * Why not hand-written
 * --------------------
 * The OpenCV.js type declarations in the ecosystem (@opencvjs/types, TechStark's src/)
 * **do not match the runtime**: they declare SIFT / PCA / FlannBasedMatcher, which do not
 * exist at runtime, and miss FaceDetectorYN, which does. Their lineage goes back to
 * mirada in 2019, maintained by hand ever since. The result is the worst kind of bug:
 * code passes type checking and then throws at runtime.
 *
 * Hand-written declarations always drift, because nothing ties them to the artifact: a
 * whitelist line changes, Embind's overload dispatch changes, and the declarations stay
 * put. This project has the artifact, so it does not have to guess: the top-level symbol
 * set comes straight from `Object.keys(cv)`, the Mat members from its prototype chain.
 *
 * What these declarations guarantee, and what they do not
 * -------------------------------------------------------
 * Guaranteed: **the declared symbol set equals the runtime symbol set exactly** (both
 *   directions, asserted by test/types/dts-consistency.test.js; that assertion is the
 *   whole point).
 * Not guaranteed: precise parameter types for every native function. That would mean
 *   parsing OpenCV's C++ signatures and reproducing Embind's overload dispatch, which is
 *   beyond this project — so every native binding without a hand-written signature is
 *   `(...args: any[]): any`. **Rather say less than say something wrong**: one symbol
 *   that does not exist does more harm than one `any`, which is exactly where the other
 *   .d.ts files in the ecosystem fail.
 * Exception: the extension layer written here (roiClone / DATA / PTR / replaceMatOn* and
 *   so on) gets precise signatures — it is this project's own code.
 *
 * Do not edit dist/index.d.ts by hand: dist/ is rebuilt from scratch by every assemble.
 * To change a signature, change CV_SIGNATURES / MAT_SIGNATURES below.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Hand-written signature tables.
//
// Every name in them must exist at runtime, or generation fails (see checkKnown): the
// hand-written half must not drift either.
// ---------------------------------------------------------------------------

/** Top-level cv: this project's extensions, the glue's value-type constructors, and a few verified members. */
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
 * Mat members.
 *
 * The extension layer (from DATA down) is this project's own code, with precise
 * signatures. The return values of the native members above it were all verified on
 * this build (on a 3×3 CV_32FC2): size() gives {width, height}, matSize / step are plain
 * arrays, row / col / diag / roi / t / rowRange / colRange / clone give a Mat, and
 * create() returns undefined. Every other native method is `(...args: any[]): any`.
 */
const MAT_SIGNATURES = {
  // Embind object lifetime (on ClassHandle.prototype, not Mat.prototype)
  delete: "delete(): void;",
  isDeleted: "isDeleted(): boolean;",
  deleteLater: "deleteLater(): this;",
  isAliasOf: "isAliasOf(other: unknown): boolean;",
  // Verified native bindings
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
  // This project's extension layer
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

// Markers around the generated blocks. test/types/dts-consistency.test.js uses them to
// extract "the declared symbol set", so the format must stay one symbol per line.
const CV_BEGIN = "// #region generated:cv";
const CV_END = "// #endregion generated:cv";
const MAT_BEGIN = "// #region generated:Mat";
const MAT_END = "// #endregion generated:Mat";

/**
 * Every own enumerable member of a Mat instance.
 *
 * The whole prototype chain must be walked: `delete` / `isDeleted` / `deleteLater` /
 * `isAliasOf` live on Embind's ClassHandle.prototype, not on Mat.prototype. Dumping only
 * Object.keys(cv.Mat.prototype) would miss them, and `mat.delete()` appears in **every**
 * example of this project — every example would fail for TS users.
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

/** Finds a member's property descriptor along the prototype chain (to tell accessors from methods). */
function findDescriptor(MatCtor, name) {
  let proto = MatCtor.prototype;
  while (proto && proto !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

/** Every name in a hand-written table must exist at runtime, or this is one more lying declaration. */
function checkKnown(table, actual, what) {
  const missing = Object.keys(table).filter((k) => !actual.includes(k));
  if (missing.length > 0) {
    throw new Error(
      `The hand-written signature table for ${what} has symbols that do not exist at runtime: ` +
        `${missing.join(", ")}\nThat is exactly the failure described at the top of this ` +
        `file. Remove them, or check whether the artifacts changed.`,
    );
  }
}

/**
 * Every symbol name must be a valid JS identifier.
 *
 * All of them are (1450 + 75 on the 4.14.0 artifacts, 1653 + 75 on 5.0.0, 1634 + 75 on
 * 5.0.0 built with emsdk 6.0.12, without exception). The explicit check is here because
 * a name with, say, a hyphen would be emitted as `foo-bar: number;` — **invalid TS** — and
 * this repository has no TypeScript dependency and CI does no type checking, so nobody
 * would notice. Rather fail at generation than publish declarations that do not compile.
 * If it ever happens, quote such names here (and update the parsing regex in
 * test/types/dts-consistency.test.js).
 */
function checkIdentifiers(names, what) {
  const bad = names.filter((n) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
  if (bad.length > 0) {
    throw new Error(
      `${what} has symbol names that are not valid identifiers: ${bad.join(", ")}\n` +
        `Emitting them as they are would produce invalid TS; they need quoting, see the ` +
        `comment on this function.`,
    );
  }
}

/** The automatic declaration of a top-level cv member (typed by its runtime typeof). */
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

/** The automatic declaration of a Mat member. */
function autoMatMember(MatCtor, name) {
  const desc = findDescriptor(MatCtor, name);
  if (desc && typeof desc.value === "function") {
    return `${name}(...args: any[]): any;`;
  }
  return `${name}: any;`;
}

/** Renders the whole .d.ts. */
function render(cv) {
  const cvKeys = Object.keys(cv).sort();
  const matKeys = dumpMatMembers(cv.Mat).sort();
  // Declared only when this runtime has it: artifacts built with emsdk 6.0.12 put delete()
  // under Symbol.dispose on every Embind object, older ones do not.
  const disposable =
    typeof Symbol.dispose === "symbol" &&
    typeof cv.Mat.prototype[Symbol.dispose] === "function";

  checkKnown(CV_SIGNATURES, cvKeys, "top-level cv");
  checkKnown(MAT_SIGNATURES, matKeys, "Mat members");
  checkIdentifiers(cvKeys, "top-level cv");
  checkIdentifiers(matKeys, "Mat members");

  const known = (keys, table) => keys.filter((k) => table[k] !== undefined);
  const auto = (keys, table) => keys.filter((k) => table[k] === undefined);

  const lines = [];
  const push = (indent, text) =>
    lines.push(text ? " ".repeat(indent) + text : "");

  for (const line of [
    "// Generated by build/gen-types.js from the assembled dist/ artifacts. Do not edit.",
    "// Regenerate with npm run assemble (or node build/gen-types.js [dist dir]).",
    "//",
    "// Top-level symbols come from the runtime's Object.keys(cv) and Mat members from the",
    "// whole prototype chain of a Mat instance, so every symbol declared here exists and every",
    "// existing symbol is declared; test/types/dts-consistency.test.js asserts both directions.",
    "// That is where the hand-written OpenCV.js declarations in the ecosystem fail: they",
    "// declare SIFT / PCA / FlannBasedMatcher, which the runtime lacks, and miss FaceDetectorYN,",
    "// which it has, so code type-checks and then throws at runtime.",
    "//",
    "// Native bindings without a hand-written signature are (...args: any[]): any; precise",
    "// parameters would need OpenCV's C++ signatures and Embind's overload dispatch, which is",
    "// beyond this project. The extension layer written in this project has precise signatures.",
  ]) {
    push(0, line);
  }
  push(0, "");
  push(
    0,
    `// Symbols: ${cvKeys.length} top-level, ${matKeys.length} Mat members`,
  );
  push(0, "");
  push(
    0,
    "declare function loadOpenCV(options?: loadOpenCV.LoadOptions): Promise<loadOpenCV.CV>;",
  );
  push(0, "");
  push(0, "declare namespace loadOpenCV {");

  push(2, "/** Options for loadOpenCV(). */");
  push(2, "interface LoadOptions {");
  push(4, "/**");
  push(
    4,
    " * Forces a wasm variant. Without it, the variant is chosen by runtime WebAssembly SIMD",
  );
  push(
    4,
    " * detection (the OPENCV_SIMD environment variable ranks between the two).",
  );
  push(4, " *");
  push(
    4,
    " * A variant asked for explicitly that is missing **throws**; it never falls back to the",
  );
  push(
    4,
    ' * other one, which would turn "run everything on this variant" into a false report.',
  );
  push(4, " */");
  push(4, "simd?: boolean;");
  push(2, "}");
  push(0, "");
  push(2, "/**");
  push(2, " * Whether the engine supports WebAssembly SIMD.");
  push(2, " *");
  push(
    2,
    " * Reports the engine's capability, not which variant was loaded: with OPENCV_SIMD=0 the",
  );
  push(2, " * engine still supports SIMD, but baseline is loaded.");
  push(2, " */");
  push(2, "function detectSimd(): boolean;");
  push(0, "");
  push(
    2,
    "/** A native binding without a hand-written signature: callable as a function or with new. */",
  );
  push(2, "interface OpenCVBinding {");
  push(4, "(...args: any[]): any;");
  push(4, "new (...args: any[]): any;");
  push(2, "}");
  push(0, "");
  push(
    2,
    "/** The TypedArray DATA() / PTR() return, chosen by the Mat's depth(). */",
  );
  push(
    2,
    "type MatTypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Int32Array | Float32Array | Float64Array;",
  );
  push(0, "");

  // The glue's value types (plain JS classes; each constructor overload was written
  // against the implementation in dist/baseline/opencv.js)
  for (const block of [
    [
      "/** cv.Point, a plain JS class in the glue; components default to 0. */",
      "interface Point { x: number; y: number; }",
      "interface PointConstructor { new (x?: number, y?: number): Point; }",
    ],
    [
      "/** cv.Size, a plain JS class in the glue; components default to 0. */",
      "interface Size { width: number; height: number; }",
      "interface SizeConstructor { new (width?: number, height?: number): Size; }",
    ],
    [
      "/** cv.Rect: takes 0, 1 (another Rect), 2 (Point + Size) or 4 arguments. */",
      "interface Rect { x: number; y: number; width: number; height: number; }",
      "interface RectConstructor {",
      "  new (): Rect;",
      "  new (rect: Rect): Rect;",
      "  new (point: Point, size: Size): Rect;",
      "  new (x: number, y: number, width: number, height: number): Rect;",
      "}",
    ],
    [
      "/** cv.Range, a plain JS class in the glue. */",
      "interface Range { start: number; end: number; }",
      "interface RangeConstructor { new (start?: number, end?: number): Range; }",
    ],
    [
      "/**",
      " * cv.Scalar: its prototype is an Array instance; the four components default to 0.",
      " *",
      " * The static cv.Scalar.all(v) is written `return Scalar(v, v, v, v)` in the glue (no",
      " * new), so calling it throws `TypeError: this.push is not a function`. It is declared",
      " * because it exists, but do not use it.",
      " */",
      "interface Scalar extends Array<number> {}",
      "interface ScalarConstructor {",
      "  new (v0?: number, v1?: number, v2?: number, v3?: number): Scalar;",
      "  all(v: number): Scalar;",
      "}",
    ],
    [
      "/** cv.RotatedRect: takes 0 or 3 arguments. */",
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
      "/** cv.TermCriteria: takes 0 or 3 arguments. */",
      "interface TermCriteria { type: number; maxCount: number; epsilon: number; }",
      "interface TermCriteriaConstructor {",
      "  new (): TermCriteria;",
      "  new (type: number, maxCount: number, epsilon: number): TermCriteria;",
      "}",
    ],
    [
      "/**",
      " * cv.MinMaxLoc: takes 0 or 4 arguments.",
      " *",
      " * minLoc / maxLoc include undefined for a reason: the 0-argument constructor in the",
      " * glue does `this.minLoc = Point(0, 0)` without new, so `new cv.MinMaxLoc().minLoc` is",
      " * undefined. The same kind of glue bug as cv.Scalar.all. The 4-argument constructor",
      " * works.",
      " */",
      "interface MinMaxLoc { minVal: number; maxVal: number; minLoc: Point | undefined; maxLoc: Point | undefined; }",
      "interface MinMaxLocConstructor {",
      "  new (): MinMaxLoc;",
      "  new (minVal: number, maxVal: number, minLoc: Point, maxLoc: Point): MinMaxLoc;",
      "}",
    ],
    [
      "/**",
      " * cv.Circle: takes 0 or 2 arguments.",
      " *",
      " * center includes undefined for the same reason as MinMaxLoc: `Point(0, 0)` in the",
      " * 0-argument constructor lacks new, and `new cv.Circle().center` is undefined.",
      " */",
      "interface Circle { center: Point | undefined; radius: number; }",
      "interface CircleConstructor {",
      "  new (): Circle;",
      "  new (center: Point, radius: number): Circle;",
      "}",
    ],
    [
      "/**",
      " * The cv.Mat constructor.",
      " *",
      " * Embind dispatches **on argument count only**, so there is one signature per count.",
      " * These five are all that exist: 0 arguments, 1 (copy), 2 (Size + type), 3 (rows +",
      " * cols + type) and 4 (plus a Scalar). Note that there is **no** (Size, type, Scalar):",
      " * that is 3 arguments, dispatched to (rows, cols, type), and silently gives a malformed",
      " * 0×5 Mat instead of an error.",
      " *",
      " * Mats are freed with delete(), or with `using` where the runtime has Symbol.dispose",
      " * (see Mat below).",
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

  // Mat members
  push(2, "interface Mat {");
  push(4, MAT_BEGIN);
  push(
    4,
    "// This project's extension layer and verified native members (precise signatures)",
  );
  for (const name of known(matKeys, MAT_SIGNATURES)) {
    push(4, MAT_SIGNATURES[name]);
  }
  const autoMat = auto(matKeys, MAT_SIGNATURES);
  if (autoMat.length > 0) {
    push(0, "");
    push(
      4,
      "// Other native bindings (existence from the runtime, signatures not annotated)",
    );
    for (const name of autoMat) push(4, autoMatMember(cv.Mat, name));
  }
  push(4, MAT_END);
  if (disposable) {
    push(
      4,
      "/** delete() under Symbol.dispose, so `using m = …` frees the Mat at scope exit. */",
    );
    push(4, "[Symbol.dispose](): void;");
  }
  push(2, "}");
  push(0, "");

  // Top-level cv
  push(2, "/** The cv object that await loadOpenCV() resolves to. */");
  push(2, "interface CV {");
  push(4, CV_BEGIN);
  push(4, "// Precise signatures");
  for (const name of known(cvKeys, CV_SIGNATURES)) {
    push(4, CV_SIGNATURES[name]);
  }
  push(0, "");
  push(
    4,
    "// Other symbols (existence from the runtime's Object.keys(cv), typed by typeof)",
  );
  for (const name of auto(cvKeys, CV_SIGNATURES)) {
    push(4, autoCvMember(name, cv[name]));
  }
  push(4, CV_END);
  push(2, "}");
  push(0, "}");
  push(0, "");
  if (disposable) {
    // Without this, projects compiling against plain ES2022 libs (no esnext.disposable and
    // no @types/node) fail on the [Symbol.dispose] member above with TS2550. It is the
    // same declaration TypeScript's lib and @types/node make, and merges with both
    // (checked with TypeScript 5.9 and 7.0).
    push(0, "declare global {");
    push(2, "interface SymbolConstructor {");
    push(4, "readonly dispose: unique symbol;");
    push(2, "}");
    push(0, "}");
    push(0, "");
  }
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
    throw new Error(`${entry} not found; run build/assemble.sh first`);
  }
  // Always generate from the baseline variant ({ simd: false } rather than an environment
  // variable nobody remembers when running this by hand). There is one declaration file
  // and it must describe both variants, so its source must be fixed; otherwise the same
  // sources would generate different .d.ts files on machines with and without the SIMD
  // artifacts. Whether both variants expose the same API is for the tests: CI runs the
  // whole suite again with OPENCV_SIMD=1, and test/types/dts-consistency.test.js then
  // checks these declarations against the SIMD runtime's symbol set.
  const cv = await require(entry)({ simd: false });
  if (typeof cv.Mat !== "function") {
    throw new Error(
      "cv.Mat is not a constructor; the wasm runtime is not ready",
    );
  }
  const out = path.join(distDir, "index.d.ts");
  fs.writeFileSync(out, render(cv));
  const cvCount = Object.keys(cv).length;
  const matCount = dumpMatMembers(cv.Mat).length;
  console.log(
    `==> ${out} (${cvCount} top-level symbols, ${matCount} Mat members)`,
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
    console.error(`❌ Generating .d.ts failed: ${(e && e.message) || e}`);
    process.exit(1);
  });
}
