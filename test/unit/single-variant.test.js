"use strict";

// One variant per process: asking for the other variant must be stopped before its glue
// is touched.
//
// OpenCV's UMD wrapper leaks Module as an implicit global (see the top of
// test/variant-cases.js). Once the second variant's glue is required, it first writes its
// JS helpers onto the **first instance** and only then throws "Cannot register public
// name 'IntVector' twice" during Embind registration. The first instance's
// cv.matFromArray gets replaced and silently loses its length check: the documented
// "it throws" is true, but by then the loaded instance is already damaged.
//
// This file controls the load order itself instead of using helpers.getCv(); node --test
// runs every file in its own process, so these loads do not affect other test files.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { DIST } = require("../helpers");

const loadCV = require(path.join(DIST, "index.js"));
const { parseEnvSimd } = require(path.join(DIST, "simd-detect.js"));

test("asking for simd after baseline is loaded throws before loading, and the loaded instance is intact", async () => {
  const cv = await loadCV({ simd: false });

  await assert.rejects(loadCV({ simd: true }), (e) => {
    assert.ok(
      e instanceof Error && e.name === "Error",
      `expected a plain Error, got ${e && e.name}: ${e && e.message}`,
    );
    assert.match(e.message, /has already loaded the baseline variant/);
    return true;
  });

  // The first instance's guards are still in place: a short array is still rejected
  // instead of producing uninitialized heap memory.
  assert.throws(() => cv.matFromArray(3, 3, cv.CV_32FC1, [1]), RangeError);
  const m = cv.matFromArray(1, 2, cv.CV_32FC1, [1, 2]);
  const r = m.roiClone(new cv.Rect(1, 0, 1, 1));
  try {
    assert.deepStrictEqual(Array.from(r.data32F), [2]);
  } finally {
    r.delete();
    m.delete();
  }
});

test("once a variant is loaded, calls that name none reuse it (an environment variable naming the other one throws)", async () => {
  const cv = await loadCV({ simd: false });
  const fromEnv = parseEnvSimd(process.env.OPENCV_SIMD);
  if (fromEnv === true) {
    // OPENCV_SIMD=1 names a variant explicitly and conflicts with the loaded baseline:
    // throw instead of quietly switching.
    await assert.rejects(
      loadCV(),
      /the environment variable OPENCV_SIMD asks for the simd variant/,
    );
  } else {
    // Unset (automatic) or OPENCV_SIMD=0: the very same loaded instance comes back.
    assert.strictEqual(await loadCV(), cv);
  }
});
