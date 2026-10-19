"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { getCv, DEPTHS, CHANNELS, makeMat } = require("../helpers");

// Upstream OpenCV once let clone() silently degrade to a shallow copy (PR #26643), and
// nobody noticed for about seven months (introduced 2024-12, reported by an outside user
// in 2025-07). It happened again with Emscripten 4.0.0 (see
// build/patches/opencv-js-deep-clone.patch). roiClone / colClone / diagClone are all built
// on clone() (see cloneAndRelease in src/js/mat-region.js), so it cannot be assumed
// correct — a test must fire the moment it degrades.
for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    test(`clone() is a deep copy for CV_${depth}C${channels}`, async () => {
      const cv = await getCv();
      const { mat } = makeMat(cv, depth, channels);
      const copy = mat.clone();

      try {
        const before = Array.from(copy.DATA());
        const src = mat.DATA();
        // Change the source. data[0] is always 1, and 1 + 100 = 101 fits CV_8S's
        // -128..127, so nothing overflows (an overflow would not hide a failure, but would
        // make its message harder to read).
        src[0] = src[0] + 100;

        assert.deepStrictEqual(
          Array.from(copy.DATA()),
          before,
          `clone() degraded to a shallow copy: the copy changed with the source Mat`,
        );
      } finally {
        mat.delete();
        copy.delete();
      }
    });
  }
}

// This case pins both halves of 2.0's semantics: the fixed method returns a copy, **and**
// the native method is not overridden. 1.x had only the first half — it put the fix on
// native roi() itself, silently changing its view semantics, so `mat.roi(r).setTo(...)`
// no longer wrote back to the source Mat and reported nothing.
test("roiClone() returns an independent copy and native roi() is still a view", async () => {
  const cv = await getCv();
  const { mat } = makeMat(cv, "32F", 1);
  const region = mat.roiClone(new cv.Rect(1, 1, 2, 2));
  const view = mat.roi(new cv.Rect(1, 1, 2, 2));

  try {
    const before = Array.from(region.DATA());

    const src = mat.DATA();
    for (let i = 0; i < src.length; i += 1) src[i] = 0; // clear the source

    assert.deepStrictEqual(
      Array.from(region.DATA()),
      before,
      "roiClone()'s result shares memory with the source: the region changed with the source",
    );

    // On a 3×3 CV_32FC1, Rect(1,1,2,2) covers (1,1)(1,2)(2,1)(2,2) → indices 4,5,7,8
    view.setTo(new cv.Scalar(7, 7, 7, 7));
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [0, 0, 0, 0, 7, 7, 0, 7, 7],
      "native roi() no longer writes back to the source Mat; native methods must not be overridden",
    );
  } finally {
    mat.delete();
    region.delete();
    view.delete();
  }
});
