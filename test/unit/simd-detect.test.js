"use strict";

// WebAssembly SIMD detection and variant selection.
//
// How the false branch is tested
// ------------------------------
// The probe returns true on an engine that supports SIMD, which can be tested directly
// (Node 22 does). "Returns false on an engine without SIMD" cannot — no such engine is at
// hand — and it is the half that matters most: a probe that always said true would hand
// every engine without SIMD a wasm it cannot run.
//
// So the claim is split into two assertions that can each be proved:
//
//   1. WebAssembly.validate() really checks function bodies; it does not return true
//      after looking at the magic number.
//      Break the SIMD opcode and validate must return false.
//   2. The SIMD parts of the probe module are load-bearing, not decoration.
//      Change the result type v128 (0x7b) to i32 (0x7f) and validate must return false;
//      an otherwise identical module with v128 and the body replaced by scalars must
//      validate.
//
// Together, 1 and 2 show that the module's validity rests entirely on whether the engine
// knows SIMD. An engine that does not can only return false under mechanism 1. Without a
// counterexample engine, this is the strongest evidence available.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { DIST } = require("../helpers");

// Test the assembled copy (same reason as in helpers.js: users get dist/).
const simd = require(path.join(DIST, "simd-detect.js"));

/** A copy of the probe module with one byte changed. The original is the production copy and must not be touched. */
function mutated(index, value) {
  const bytes = simd.SIMD_PROBE.slice();
  bytes[index] = value;
  return bytes;
}

test("the probe module is 31 bytes and starts with a valid wasm magic number and version", () => {
  assert.strictEqual(simd.SIMD_PROBE.length, 31);
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(0, 8)),
    [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    'the first 8 bytes should be "\\0asm" + version 1',
  );
});

test("the probe's function returns v128 and its body has two 0xfd-prefixed SIMD instructions", () => {
  // Type section: 01 05 | 01 | 60 00 01 7b
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(8, 15)),
    [0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b],
    "the type section should declare func () -> (v128); 0x7b is v128",
  );
  // Code section body: 00 | 41 00 | fd 0f | fd 62 | 0b
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(23, 31)),
    [0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b],
    "the body should be i32.const 0 / i8x16.splat / i8x16.popcnt / end",
  );
});

test("probeSimd() returns true on a runtime with SIMD", () => {
  // WebAssembly SIMD is on by default since Node 16.4 (V8 9.1) and this package requires
  // node >= 22, so this should be true on every supported Node. If it is false, either
  // the probe bytes are wrong or the runtime is older than it claims.
  assert.strictEqual(
    simd.probeSimd(),
    true,
    "this runtime should support WebAssembly SIMD (node >= 22)",
  );
});

test("WebAssembly.validate really checks the body: a broken SIMD instruction gives false", () => {
  // Index 29 is 0x62, the sub-opcode of i8x16.popcnt.
  assert.strictEqual(simd.SIMD_PROBE[29], 0x62);

  // 0xfe / 0xff: SIMD sub-opcodes are LEB128-encoded u32s, and a set high bit means
  // "more bytes follow", but 0x0b (end) follows here, so the encoding is truncated and
  // the module malformed. This does not depend on which opcodes are assigned, so new
  // instructions cannot invalidate it.
  for (const bad of [0xfe, 0xff]) {
    assert.strictEqual(
      WebAssembly.validate(mutated(29, bad)),
      false,
      `0xfd 0x${bad.toString(16)} is truncated LEB128; validate should be false`,
    );
  }

  // 0x0f: i8x16.splat is a valid instruction, but its signature is i32 -> v128, and the
  // top of the stack is already the v128 pushed by the previous splat — a type mismatch.
  // This proves validate really **type-checks** instead of just recognizing opcodes.
  //
  // "Pick any unassigned opcode" is deliberately not used for this: 239 of the 256
  // single-byte sub-opcodes are invalid in this position, but mostly because of the
  // operand count (most SIMD instructions take two v128s and the stack has one), not
  // because the opcode does not exist — it would not prove that validate rejects
  // unknown instructions.
  assert.strictEqual(
    WebAssembly.validate(mutated(29, 0x0f)),
    false,
    "i8x16.splat expects an i32 but the top of the stack is a v128; validate should be false",
  );
});

test("v128 is load-bearing: with the result type changed to i32, validate gives false", () => {
  assert.strictEqual(simd.SIMD_PROBE[14], 0x7b, "index 14 should be v128");
  assert.strictEqual(
    WebAssembly.validate(mutated(14, 0x7f)),
    false,
    "the body pushes a v128, so an i32 signature mismatches; validate should be false",
  );
});

test("an otherwise identical scalar module validates: the shell itself is valid", () => {
  // Exactly the probe's structure, with v128 replaced by i32 and the body by
  // i32.const 0. Since this is true, an engine without SIMD can return false for the
  // probe only because of SIMD, not because the module is malformed.
  // prettier-ignore
  const scalar = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
    0x03, 0x02, 0x01, 0x00,
    0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x00, 0x0b,
  ]);
  assert.strictEqual(WebAssembly.validate(scalar), true);
});

test("detectSimd() is memoized and agrees with the unmemoized probeSimd()", () => {
  simd.resetSimdCache();
  const first = simd.detectSimd();
  assert.strictEqual(first, simd.probeSimd());
  assert.strictEqual(
    simd.detectSimd(),
    first,
    "the second call should return the same result",
  );
});

test("parseEnvSimd recognizes true / false values and returns undefined when unset", () => {
  for (const v of ["1", "true", "TRUE", " on ", "yes"]) {
    assert.strictEqual(simd.parseEnvSimd(v), true, `${JSON.stringify(v)}`);
  }
  for (const v of ["0", "false", "OFF", " no "]) {
    assert.strictEqual(simd.parseEnvSimd(v), false, `${JSON.stringify(v)}`);
  }
  for (const v of [undefined, null, ""]) {
    assert.strictEqual(simd.parseEnvSimd(v), undefined);
  }
});

test("parseEnvSimd throws on an unrecognized value instead of ignoring it", () => {
  // Silently ignoring OPENCV_SIMD=ture would make the user believe SIMD was forced while
  // the probe decided — "thought it was checked, but it was not", the failure mode this
  // repository keeps removing.
  assert.throws(() => simd.parseEnvSimd("ture"), {
    name: "TypeError",
    message: /Unrecognized OPENCV_SIMD value/,
  });
  assert.throws(() => simd.parseEnvSimd("2"), { name: "TypeError" });
});

test("resolveVariant precedence: options > environment variable > probe", () => {
  const envOn = { OPENCV_SIMD: "1" };
  const envOff = { OPENCV_SIMD: "0" };

  assert.deepStrictEqual(simd.resolveVariant({ simd: true }, envOff), {
    variant: "simd",
    source: "option",
  });
  assert.deepStrictEqual(simd.resolveVariant({ simd: false }, envOn), {
    variant: "baseline",
    source: "option",
  });
  assert.deepStrictEqual(simd.resolveVariant(undefined, envOn), {
    variant: "simd",
    source: "env",
  });
  assert.deepStrictEqual(simd.resolveVariant({}, envOff), {
    variant: "baseline",
    source: "env",
  });
  assert.deepStrictEqual(simd.resolveVariant(undefined, {}), {
    variant: simd.detectSimd() ? "simd" : "baseline",
    source: "probe",
  });
});

test("resolveVariant rejects a non-boolean simd and non-object options", () => {
  // { simd: null } must throw too: null !== undefined, it is "passed something
  // unrecognized", not "passed nothing". Treating it as absent would fall back to the
  // probe while the user believes a variant was chosen.
  for (const bad of ["true", 1, 0, null, {}]) {
    assert.throws(() => simd.resolveVariant({ simd: bad }, {}), {
      name: "TypeError",
      message: /accepts only a boolean/,
    });
  }
  assert.throws(() => simd.resolveVariant("baseline", {}), {
    name: "TypeError",
    message: /must be an object/,
  });
  // null and undefined both mean "no options"
  assert.strictEqual(simd.resolveVariant(null, {}).source, "probe");
  assert.strictEqual(simd.resolveVariant(undefined, {}).source, "probe");
});

test("dist/ has the per-variant layout: baseline is always there, and no flat glue at the top", () => {
  // This watches the output shape of build/assemble.sh. Both variants' .wasm files carry
  // the compile-time name "opencv_js.wasm" and must live in separate directories. If the
  // layout were made flat again, require("./baseline/opencv.js") in src/js/index.js would
  // not find its file, and the resulting MODULE_NOT_FOUND could be handled by automatic
  // selection like an ordinary "simd variant missing", hiding the real cause.
  for (const f of ["opencv.js", "opencv_js.wasm"]) {
    assert.ok(
      fs.existsSync(path.join(DIST, "baseline", f)),
      `dist/baseline/${f} is missing`,
    );
    assert.ok(
      !fs.existsSync(path.join(DIST, f)),
      `dist/${f} should not exist; artifacts are split by variant since 2.1`,
    );
  }
  // simd is optional (a local build may have baseline only), but if its directory exists
  // both files must be in it.
  if (fs.existsSync(path.join(DIST, "simd"))) {
    for (const f of ["opencv.js", "opencv_js.wasm"]) {
      assert.ok(
        fs.existsSync(path.join(DIST, "simd", f)),
        `dist/simd/ exists but ${f} is missing`,
      );
    }
  }
});
