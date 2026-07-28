"use strict";

// dist/index.d.ts 与运行时的符号一致性。
//
// **这条断言是自动生成 .d.ts 这件事的全部意义。** 没有它，那份文件就只是又一份会
// 漂移的手写声明——生态里 @opencvjs/types 与 TechStark 的声明正是这样烂掉的：它们
// 声明了运行时并不存在的 SIFT / PCA / FlannBasedMatcher，又漏掉了确实存在的
// FaceDetectorYN，于是用户的代码能过类型检查、运行时才抛异常。
//
// 断言是**双向**的：
//   .d.ts 里声明的每个符号，运行时都必须有（否则就是在说谎）
//   运行时有的每个符号，.d.ts 里都必须声明（否则合法代码被类型检查拒绝）
//
// 本文件里的「运行时符号」与「已声明符号」都是独立算出来的——不调用
// build/gen-types.js 的任何一个函数去取。生成器有 bug 时，这里必须能看出来。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { getCv, DIST } = require("../helpers");

const DTS_PATH = path.join(DIST, "index.d.ts");

// 与 build/gen-types.js 里的标记一致。若哪天对不上，下面解析出的集合会是空的，
// 而空集会被「规模下限」那条断言拦住——不会静默通过。
const REGIONS = {
  cv: ["// #region generated:cv", "// #endregion generated:cv"],
  Mat: ["// #region generated:Mat", "// #endregion generated:Mat"],
};

/** 一个成员声明行里的符号名。识别 `readonly NAME: T;` / `NAME: T;` / `NAME(...): T;`。 */
const MEMBER = /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[(:]/;

/**
 * 取出 .d.ts 里某个生成区块声明的全部符号名。
 *
 * 区块内的每一行要么是空行、要么是注释、要么必须能解析出符号名——解析不了就报错，
 * 而不是跳过。「解析器悄悄忽略了半个文件」和「声明与运行时不符」是同一类失败。
 */
function declaredSymbols(source, region) {
  const [begin, end] = REGIONS[region];
  const lines = source.split("\n");
  const from = lines.findIndex((l) => l.trim() === begin);
  const to = lines.findIndex((l) => l.trim() === end);
  assert.ok(from >= 0, `dist/index.d.ts 里找不到起始标记 ${begin}`);
  assert.ok(to > from, `dist/index.d.ts 里找不到结束标记 ${end}`);

  const names = [];
  for (let i = from + 1; i < to; i += 1) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("//")) continue;
    const m = MEMBER.exec(line);
    assert.ok(
      m,
      `dist/index.d.ts 第 ${i + 1} 行解析不出符号名，本测试无法判断它声明了什么: ${line}`,
    );
    names.push(m[1]);
  }
  return names;
}

/** 运行时的 Mat 成员：必须走整条原型链，delete/isDeleted 挂在 embind 的 ClassHandle 上。 */
function runtimeMatMembers(MatCtor) {
  const names = new Set();
  let proto = MatCtor.prototype;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.keys(proto)) names.add(key);
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

function readDts() {
  assert.ok(
    fs.existsSync(DTS_PATH),
    `缺少 ${DTS_PATH} —— 由 build/assemble.sh 生成，先跑 npm run assemble`,
  );
  return fs.readFileSync(DTS_PATH, "utf8");
}

/** 两个方向都比，并把差集完整打出来（只说「不相等」没法排查）。 */
function assertSameSet(declared, runtime, what) {
  const declaredSet = new Set(declared);
  const runtimeSet = new Set(runtime);

  assert.strictEqual(
    declared.length,
    declaredSet.size,
    `${what}: .d.ts 里有重复声明的符号`,
  );

  const phantom = [...declaredSet].filter((n) => !runtimeSet.has(n));
  assert.deepStrictEqual(
    phantom,
    [],
    `${what}: .d.ts 声明了 ${phantom.length} 个运行时并不存在的符号 —— ` +
      `这正是生态里那几份 .d.ts 的失败方式: ${phantom.slice(0, 20).join(", ")}`,
  );

  const missing = [...runtimeSet].filter((n) => !declaredSet.has(n));
  assert.deepStrictEqual(
    missing,
    [],
    `${what}: 运行时有 ${missing.length} 个符号没有被声明 —— TS 用户用到它们会被类型检查拒绝: ` +
      `${missing.slice(0, 20).join(", ")}`,
  );
}

test(".d.ts 声明的 cv 顶层符号集与运行时严格相等", async () => {
  const cv = await getCv();
  const runtime = Object.keys(cv);
  const declared = declaredSymbols(readDts(), "cv");

  // 规模下限：两个集合都空时「相等」也成立，那样这条门禁就什么都没查。
  // 本产物实测 1450 个顶层符号；取 1000 作下限，既能拦住空集，也不会因为上游
  // 增删几个符号就误报。
  assert.ok(
    runtime.length > 1000,
    `运行时只 dump 到 ${runtime.length} 个顶层符号 —— 加载或 dump 出了问题`,
  );
  assert.ok(
    declared.length > 1000,
    `.d.ts 里只解析出 ${declared.length} 个符号 —— 标记或解析出了问题`,
  );

  assertSameSet(declared, runtime, "cv 顶层");
});

test(".d.ts 声明的 Mat 成员集与运行时严格相等", async () => {
  const cv = await getCv();
  const runtime = runtimeMatMembers(cv.Mat);
  const declared = declaredSymbols(readDts(), "Mat");

  assert.ok(
    runtime.length > 50,
    `运行时只 dump 到 ${runtime.length} 个 Mat 成员 —— dump 出了问题`,
  );
  assert.ok(
    declared.length > 50,
    `.d.ts 里只解析出 ${declared.length} 个 Mat 成员 —— 解析出了问题`,
  );

  assertSameSet(declared, runtime, "Mat 成员");
});

test("Mat 的成员必须包含 embind 的 delete()（只 dump Mat.prototype 会漏掉）", async () => {
  const cv = await getCv();
  const declared = new Set(declaredSymbols(readDts(), "Mat"));
  // delete / isDeleted / deleteLater / isAliasOf 挂在 ClassHandle.prototype 上，
  // 不在 Mat.prototype 上。mat.delete() 出现在本项目每一个示例里——漏掉它，
  // TS 用户抄任何一个示例都会报错。
  for (const name of ["delete", "isDeleted", "deleteLater", "isAliasOf"]) {
    assert.ok(
      declared.has(name),
      `.d.ts 的 Mat 里缺少 ${name}() —— dump 只取了 Mat.prototype，没走原型链`,
    );
    assert.strictEqual(
      typeof cv.matFromArray(1, 1, cv.CV_8UC1, [1])[name],
      "function",
      `运行时 Mat 上没有 ${name}`,
    );
  }
});

test("生态里那几个说谎的符号，这里一个都不许出现", async () => {
  const cv = await getCv();
  const declared = new Set(declaredSymbols(readDts(), "cv"));

  // @opencvjs/types 与 TechStark 的声明里有、而本产物运行时没有的
  for (const name of [
    "SIFT",
    "PCA",
    "FlannBasedMatcher",
    "readNetFromTensorflow",
  ]) {
    assert.strictEqual(
      cv[name],
      undefined,
      `前提变了: 运行时现在有 cv.${name} 了，这条用例的名单要更新`,
    );
    assert.strictEqual(
      declared.has(name),
      false,
      `.d.ts 声明了运行时不存在的 cv.${name}`,
    );
  }

  // 它们漏掉、而本产物确实存在的
  for (const name of ["FaceDetectorYN", "CascadeClassifier"]) {
    assert.strictEqual(
      typeof cv[name],
      "function",
      `前提变了: 运行时没有 cv.${name} 了`,
    );
    assert.ok(declared.has(name), `.d.ts 漏掉了确实存在的 cv.${name}`);
  }
});

test("dist/index.d.ts 与当前产物同步（重新生成应逐字节相同）", async () => {
  const cv = await getCv();
  const { render } = require("../../build/gen-types.js");
  assert.strictEqual(
    render(cv),
    readDts(),
    "dist/index.d.ts 与重新生成的结果不一致 —— 它被手改过，或 assemble 时没有重新生成",
  );
});

test("package.json 的 types 字段指向真实存在的声明文件", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.strictEqual(
    pkg.types,
    "dist/index.d.ts",
    "package.json 缺少 types 字段或指向别处 —— TS 用户拿不到类型",
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "..", pkg.types)),
    `package.json 的 types 指向 ${pkg.types}，但该文件不存在`,
  );
});
