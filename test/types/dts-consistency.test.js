"use strict";

// Symbol agreement between dist/index.d.ts and the runtime.
//
// **This assertion is the whole point of generating the .d.ts.** Without it the file is
// just another hand-written declaration that drifts — which is how @opencvjs/types and
// TechStark's declarations rotted: they declare SIFT / PCA / FlannBasedMatcher, which do
// not exist at runtime, and miss FaceDetectorYN, which does, so user code type-checks and
// then throws at runtime.
//
// The assertion goes **both ways**:
//   every symbol declared in the .d.ts must exist at runtime (otherwise it lies)
//   every symbol at runtime must be declared (otherwise valid code fails type checking)
//
// Both the "runtime symbols" and the "declared symbols" here are computed independently,
// without calling any function of build/gen-types.js. A bug in the generator must show up
// here.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { getCv, DIST } = require("../helpers");

const DTS_PATH = path.join(DIST, "index.d.ts");

// The same markers as in build/gen-types.js. If they ever disagree, the sets parsed below
// come out empty, and the size floor assertions stop that from passing silently.
const REGIONS = {
  cv: ["// #region generated:cv", "// #endregion generated:cv"],
  Mat: ["// #region generated:Mat", "// #endregion generated:Mat"],
};

/** The symbol name in a member declaration line: `readonly NAME: T;` / `NAME: T;` / `NAME(...): T;`. */
const MEMBER = /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[(:]/;

/**
 * Extracts every symbol name declared in one generated block of the .d.ts.
 *
 * Every line in the block must be blank, a comment, or parseable into a symbol name; a
 * line that cannot be parsed fails instead of being skipped. "The parser quietly ignored
 * half the file" is the same kind of failure as "the declarations do not match the
 * runtime".
 */
function declaredSymbols(source, region) {
  const [begin, end] = REGIONS[region];
  const lines = source.split("\n");
  const from = lines.findIndex((l) => l.trim() === begin);
  const to = lines.findIndex((l) => l.trim() === end);
  assert.ok(from >= 0, `start marker ${begin} not found in dist/index.d.ts`);
  assert.ok(to > from, `end marker ${end} not found in dist/index.d.ts`);

  const names = [];
  for (let i = from + 1; i < to; i += 1) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("//")) continue;
    const m = MEMBER.exec(line);
    assert.ok(
      m,
      `no symbol name can be parsed from line ${i + 1} of dist/index.d.ts, so this test cannot tell what it declares: ${line}`,
    );
    names.push(m[1]);
  }
  return names;
}

/** The runtime's Mat members: the whole prototype chain, since delete / isDeleted live on Embind's ClassHandle. */
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
    `${DTS_PATH} is missing; build/assemble.sh generates it, run npm run assemble first`,
  );
  return fs.readFileSync(DTS_PATH, "utf8");
}

/** Compares both directions and prints the differences in full ("not equal" alone cannot be debugged). */
function assertSameSet(declared, runtime, what) {
  const declaredSet = new Set(declared);
  const runtimeSet = new Set(runtime);

  assert.strictEqual(
    declared.length,
    declaredSet.size,
    `${what}: the .d.ts declares some symbols twice`,
  );

  const phantom = [...declaredSet].filter((n) => !runtimeSet.has(n));
  assert.deepStrictEqual(
    phantom,
    [],
    `${what}: the .d.ts declares ${phantom.length} symbol(s) that do not exist at runtime — ` +
      `exactly how the other .d.ts files in the ecosystem fail: ${phantom.slice(0, 20).join(", ")}`,
  );

  const missing = [...runtimeSet].filter((n) => !declaredSet.has(n));
  assert.deepStrictEqual(
    missing,
    [],
    `${what}: ${missing.length} runtime symbol(s) are not declared, so TS users get type errors using them: ` +
      `${missing.slice(0, 20).join(", ")}`,
  );
}

test("the top-level cv symbols declared in the .d.ts equal the runtime's exactly", async () => {
  const cv = await getCv();
  const runtime = Object.keys(cv);
  const declared = declaredSymbols(readDts(), "cv");

  // Size floor: two empty sets are "equal" too, and then this gate checks nothing. The
  // 5.0.0 artifacts have about 1600 top-level symbols (1450 on 4.14.0); 1000 stops empty
  // sets without failing when upstream adds or removes a few symbols.
  assert.ok(
    runtime.length > 1000,
    `only ${runtime.length} top-level symbols dumped at runtime; loading or dumping went wrong`,
  );
  assert.ok(
    declared.length > 1000,
    `only ${declared.length} symbols parsed from the .d.ts; the markers or the parser went wrong`,
  );

  assertSameSet(declared, runtime, "top-level cv");
});

test("the Mat members declared in the .d.ts equal the runtime's exactly", async () => {
  const cv = await getCv();
  const runtime = runtimeMatMembers(cv.Mat);
  const declared = declaredSymbols(readDts(), "Mat");

  assert.ok(
    runtime.length > 50,
    `only ${runtime.length} Mat members dumped at runtime; dumping went wrong`,
  );
  assert.ok(
    declared.length > 50,
    `only ${declared.length} Mat members parsed from the .d.ts; the parser went wrong`,
  );

  assertSameSet(declared, runtime, "Mat members");
});

test("Mat's members include Embind's delete() (dumping only Mat.prototype would miss it)", async () => {
  const cv = await getCv();
  const declared = new Set(declaredSymbols(readDts(), "Mat"));
  // delete / isDeleted / deleteLater / isAliasOf live on ClassHandle.prototype, not on
  // Mat.prototype. mat.delete() appears in every example of this project; without it TS
  // users would get an error copying any of them.
  const probe = cv.matFromArray(1, 1, cv.CV_8UC1, [1]);
  try {
    for (const name of ["delete", "isDeleted", "deleteLater", "isAliasOf"]) {
      assert.ok(
        declared.has(name),
        `the .d.ts Mat lacks ${name}(); the dump took Mat.prototype only instead of the prototype chain`,
      );
      assert.strictEqual(
        typeof probe[name],
        "function",
        `the runtime Mat has no ${name}`,
      );
    }
  } finally {
    probe.delete();
  }
});

test("Mat's [Symbol.dispose] is declared exactly when the runtime has it", async () => {
  const cv = await getCv();
  const dts = readDts();
  const runtime =
    typeof Symbol.dispose === "symbol" &&
    typeof cv.Mat.prototype[Symbol.dispose] === "function";
  const declared = /^\s*\[Symbol\.dispose\]\(\): void;$/m.test(dts);
  assert.strictEqual(
    declared,
    runtime,
    runtime
      ? "Mat has [Symbol.dispose] but the .d.ts does not declare it — TS users cannot write `using`"
      : "the .d.ts declares [Symbol.dispose], which this runtime does not have",
  );
  if (declared) {
    // Without it, projects on plain ES2022 libs fail on the member above with TS2550.
    assert.match(
      dts,
      /declare global \{\s*interface SymbolConstructor \{\s*readonly dispose: unique symbol;/,
      "the global SymbolConstructor.dispose declaration is missing",
    );
  }
});

test("none of the ecosystem's lying symbols appear here", async () => {
  const cv = await getCv();
  const declared = new Set(declaredSymbols(readDts(), "cv"));

  // Declared by @opencvjs/types and TechStark, absent from this runtime
  for (const name of [
    "SIFT",
    "PCA",
    "FlannBasedMatcher",
    "readNetFromTensorflow",
  ]) {
    assert.strictEqual(
      cv[name],
      undefined,
      `premise changed: the runtime now has cv.${name}; update this case's list`,
    );
    assert.strictEqual(
      declared.has(name),
      false,
      `the .d.ts declares cv.${name}, which does not exist at runtime`,
    );
  }

  // APIs OpenCV 5.x removed from the JS whitelist. The ecosystem's .d.ts files still
  // declare them as in 4.x; this runtime (5.0.0) lacks them and so must our .d.ts. The
  // group also pins the OpenCV version: if any reappears, the artifacts went back to 4.x.
  for (const name of [
    "CascadeClassifier",
    "HOGDescriptor",
    "AKAZE",
    "BRISK",
    "KAZE",
  ]) {
    assert.strictEqual(
      cv[name],
      undefined,
      `premise changed: the runtime has cv.${name} again; the artifacts may not be a 5.x build`,
    );
    assert.strictEqual(
      declared.has(name),
      false,
      `the .d.ts declares cv.${name}, which 5.x removed`,
    );
  }

  // Missed by them, present in this runtime
  for (const name of ["FaceDetectorYN", "ORB"]) {
    assert.strictEqual(
      typeof cv[name],
      "function",
      `premise changed: the runtime no longer has cv.${name}`,
    );
    assert.ok(declared.has(name), `the .d.ts misses cv.${name}, which exists`);
  }
});

test("dist/index.d.ts is in sync with the artifacts (regenerating gives identical bytes)", async () => {
  const cv = await getCv();
  const { render } = require("../../build/gen-types.js");
  assert.strictEqual(
    render(cv),
    readDts(),
    "dist/index.d.ts differs from a fresh generation; it was edited by hand, or assemble did not regenerate it",
  );
});

test("package.json's types field points at a declaration file that exists", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.strictEqual(
    pkg.types,
    "dist/index.d.ts",
    "package.json lacks the types field or points elsewhere; TS users get no types",
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "..", pkg.types)),
    `package.json's types points at ${pkg.types}, which does not exist`,
  );
});
