"use strict";

// Numerical semantics and addressing of the in-place writes (replaceMatOnRect / rectAdd /
// rectSubtract / replaceMatOnCol / addOnCol / replaceMatOnRow / replaceMatOnPoint).
//
// Where the expected values come from:
//   - Values written into an integer Mat follow OpenCV's saturate_cast: round half to
//     even (cvRound's rounding), then clamp to the depth's range; NaN becomes 0. That is
//     also how addConstant / mulConstant and friends (through OpenCV's convertTo) have
//     always behaved in this library. The old code assigned straight to the TypedArray,
//     which wraps modulo 2^n and truncates (250 + 20 written to 8U gave 14).
//   - Floating-point Mats are written as is (NaN / ±Infinity kept).
//   - When src shares memory with this, the copy semantics apply: src is read in full
//     before anything is written.
//   - Only channel 0 is written (except replaceMatOnRow, which writes every channel of
//     the row).
//
// Expected values are always computed by hand, never derived from the methods under test.

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** Builds a Mat, runs fn, returns the data, and releases the Mat. */
async function run(type, rows, cols, data, fn) {
  const cv = await getCv();
  const m = cv.matFromArray(rows, cols, cv[type], data);
  try {
    fn(m, cv);
    return Array.from(m.DATA());
  } finally {
    m.delete();
  }
}

test("addOnCol / rectAdd / rectSubtract saturate on 8U instead of wrapping", async () => {
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [10, 250], (m) => m.addOnCol(20, 0)),
    [30, 255],
  );
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [10, 250], (m) => m.addOnCol(-20, 0)),
    [0, 230],
  );
  const cv = await getCv();
  const src = cv.matFromArray(1, 2, cv.CV_8UC1, [100, 100]);
  try {
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 2, [200, 10], (m) =>
        m.rectAdd(src, new cv.Rect(0, 0, 2, 1)),
      ),
      [255, 110],
    );
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 2, [200, 10], (m) =>
        m.rectSubtract(src, new cv.Rect(0, 0, 2, 1)),
      ),
      [100, 0],
    );
  } finally {
    src.delete();
  }
});

test("fractions written into an integer Mat round half to even", async () => {
  // 10.7 → 11; 2.5 → 2; 3.5 → 4 (.5 goes to even, like cvRound)
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 1, [10, 2, 3], (m) => m.addOnCol(0.7, 0)),
    [11, 3, 4],
  );
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [2, 3], (m) => m.addOnCol(0.5, 0)),
    [2, 4],
  );
  assert.deepStrictEqual(
    await run("CV_16SC1", 2, 1, [-2, -3], (m) => m.addOnCol(-0.5, 0)),
    [-2, -4],
  );
});

test("replaceMatOnRect saturates and rounds a float src written into 8U, and NaN becomes 0", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(1, 4, cv.CV_32FC1, [300.7, -5, 2.5, NaN]);
  try {
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 4, [1, 1, 1, 1], (m) =>
        m.replaceMatOnRect(src, new cv.Rect(0, 0, 4, 1)),
      ),
      [255, 0, 2, 0],
    );
  } finally {
    src.delete();
  }
});

test("replaceMatOnCol / replaceMatOnRow / replaceMatOnPoint saturate when writing 8S", async () => {
  assert.deepStrictEqual(
    await run("CV_8SC1", 3, 1, [0, 0, 0], (m) =>
      m.replaceMatOnCol([200, -200, 1.5], 0),
    ),
    [127, -128, 2],
  );
  assert.deepStrictEqual(
    await run("CV_8SC1", 1, 3, [0, 0, 0], (m) =>
      m.replaceMatOnRow([200, -200, 1.5], 0),
    ),
    [127, -128, 2],
  );
  assert.deepStrictEqual(
    await run("CV_8SC1", 1, 1, [0], (m) => m.replaceMatOnPoint(-1000, 0, 0)),
    [-128],
  );
});

test("in-place writes saturate on CV_32S too (no overflow to INT_MIN)", async () => {
  assert.deepStrictEqual(
    await run("CV_32SC1", 2, 1, [2147483647, -2147483648], (m) =>
      m.addOnCol(10, 0),
    ),
    [2147483647, -2147483638],
  );
});

test("floating-point Mats are written as is: ±Infinity and NaN are kept", async () => {
  const got = await run("CV_32FC1", 3, 1, [1, 2, 3], (m) => {
    m.replaceMatOnCol([Infinity, -Infinity, NaN], 0);
  });
  assert.strictEqual(got[0], Infinity);
  assert.strictEqual(got[1], -Infinity);
  assert.ok(Number.isNaN(got[2]));
});

test("when src and this are the same Mat, copy semantics apply (src is read before writing)", async () => {
  const cv = await getCv();
  const rect = new cv.Rect(1, 1, 2, 2);
  // 3×3 [1..9]: write the top-left 2×2 (1,2 / 4,5) into the bottom-right 2×2
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) =>
      m.replaceMatOnRect(m, rect),
    ),
    [1, 2, 3, 4, 1, 2, 7, 4, 5],
  );
  // The bottom-right 2×2 plus the original top-left 2×2: 5+1, 6+2, 8+4, 9+5
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) =>
      m.rectAdd(m, rect),
    ),
    [1, 2, 3, 4, 6, 8, 7, 12, 14],
  );
});

test("copy semantics also apply when src is a view of this that overlaps the written region", async () => {
  const cv = await getCv();
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) => {
      const view = m.roi(new cv.Rect(0, 0, 2, 2));
      try {
        m.replaceMatOnRect(view, new cv.Rect(1, 1, 2, 2));
      } finally {
        view.delete();
      }
    }),
    [1, 2, 3, 4, 1, 2, 7, 4, 5],
  );
});

test("a dst that is a native roi() view is written at the view's own position and row stride", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(2, 2, cv.CV_16SC1, [10, 20, 30, 40]);
  try {
    // A 4×4 parent of zeros and its Rect(1,1,3,2) view; adding src at the view's
    // Rect(1,0,2,2) lands on (1,2)(1,3)(2,2)(2,3) of the parent
    const got = await run("CV_16SC1", 4, 4, new Array(16).fill(0), (m) => {
      const view = m.roi(new cv.Rect(1, 1, 3, 2));
      try {
        view.rectAdd(src, new cv.Rect(1, 0, 2, 2));
        view.addOnCol(5, 0); // column 0 of the view = rows 1 and 2 of the parent's column 1
      } finally {
        view.delete();
      }
    });
    // prettier-ignore
    assert.deepStrictEqual(got, [
      0, 0, 0, 0,
      0, 5, 10, 20,
      0, 5, 30, 40,
      0, 0, 0, 0,
    ]);
  } finally {
    src.delete();
  }
});

test("only channel 0 is written on multi-channel Mats (replaceMatOnRow writes every channel of the row)", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(1, 1, cv.CV_16SC2, [7, 8]);
  try {
    assert.deepStrictEqual(
      await run("CV_16SC2", 1, 2, [1, 2, 3, 4], (m) => {
        m.rectAdd(src, new cv.Rect(1, 0, 1, 1));
        m.addOnCol(100, 0);
      }),
      [101, 2, 10, 4],
    );
    assert.deepStrictEqual(
      await run("CV_16SC2", 2, 1, [1, 2, 3, 4], (m) =>
        m.replaceMatOnRow([9, 9], 1),
      ),
      [1, 2, 9, 9],
    );
  } finally {
    src.delete();
  }
});
