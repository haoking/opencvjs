"use strict";

// Extension methods on non-continuous Mats (the views returned by native roi() / col()).
//
// Since 2.0 native roi() / col() / diag() are not overridden, and the docs present them as
// the legitimate way to write back to the source Mat (README, roiClone()). So extension
// methods will be called on views, and a view's row stride is **the parent's** step:
//
//   - Embind's *Ptr(row) returns step1(0) elements, not the row's cols × channels. On a
//     view it runs past the row, and past the whole buffer on the last row — a silent
//     out-of-bounds read or write. A single-row ROI reports isContinuous() === true and is
//     affected too, so continuity cannot be the test.
//   - .data* / DATA() read contiguous memory (the README warns about it), so sum() /
//     reshapeRows(), built on them, read the wrong elements.
//
// Expected values are always computed independently from the parent's data, never derived
// from the methods under test.

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** A 3×3 parent Mat with values 1..9, CV_8UC1 by default. */
function parent3(cv, type = "CV_8UC1") {
  return cv.matFromArray(3, 3, cv[type], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

test("PTR(row) on an ROI view returns only the row's cols × channels elements", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 1, 2, 2)); // covers 5,6 / 8,9
  try {
    assert.deepStrictEqual(Array.from(v.PTR(0)), [5, 6]);
    // Last row: a view of step1(0) elements would run past the parent's 9-byte buffer
    assert.deepStrictEqual(Array.from(v.PTR(1)), [8, 9]);
  } finally {
    v.delete();
    p.delete();
  }
});

test("PTR(row) on a single-row ROI also returns only that row (its isContinuous() is true)", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 2, 2, 1)); // 8,9 of the last row
  try {
    assert.strictEqual(
      v.isContinuous(),
      true,
      "premise: OpenCV marks a single-row view as continuous",
    );
    assert.deepStrictEqual(Array.from(v.PTR(0)), [8, 9]);
  } finally {
    v.delete();
    p.delete();
  }
});

test("replaceMatOnRow on an ROI view writes only that row and leaves pixels outside the view alone", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 1, 2, 2));
  try {
    // The array is longer than the row: the extra element must be ignored. An
    // out-of-bounds implementation would write the third value (99) outside the view.
    v.replaceMatOnRow([50, 60, 99], 0);
    v.replaceMatOnRow([80, 90, 99], 1);
    assert.deepStrictEqual(
      Array.from(p.DATA()),
      [1, 2, 3, 4, 50, 60, 7, 80, 90],
    );
  } finally {
    v.delete();
    p.delete();
  }
});

test("sum() on an ROI view and a column view is the sum of the elements they contain", async () => {
  const cv = await getCv();
  const p = parent3(cv, "CV_32FC1");
  const roi = p.roi(new cv.Rect(1, 1, 2, 2));
  const col = p.col(1);
  try {
    assert.strictEqual(roi.sum(), 5 + 6 + 8 + 9);
    assert.strictEqual(col.sum(), 2 + 5 + 8);
  } finally {
    roi.delete();
    col.delete();
    p.delete();
  }
});

test("reshapeRows() on an ROI view rearranges the view's contents", async () => {
  const cv = await getCv();
  const p = parent3(cv, "CV_32FC1");
  const v = p.roi(new cv.Rect(1, 1, 2, 2));
  let out;
  try {
    out = v.reshapeRows(1);
    assert.strictEqual(out.rows, 1);
    assert.strictEqual(out.cols, 4);
    assert.deepStrictEqual(Array.from(out.DATA()), [5, 6, 8, 9]);
  } finally {
    if (out) out.delete();
    v.delete();
    p.delete();
  }
});

// Last on purpose: an out-of-bounds implementation really corrupts the heap here, and it
// must not take the other cases in the same process down with it.
test("replaceMatOnRow on the last row of a bottom-right view does not write past the heap", async () => {
  const cv = await getCv();
  // The bottom-right 1×1 of a 2×64 parent. Out of bounds, the view has length 64 and
  // writes 63 bytes past the parent's last byte — measured to corrupt the header of the
  // Mat allocated right after it.
  const p = cv.matFromArray(2, 64, cv.CV_8UC1, new Array(128).fill(1));
  const neighbors = [];
  for (let k = 0; k < 8; k += 1) {
    neighbors.push(cv.matFromArray(2, 64, cv.CV_8UC1, new Array(128).fill(7)));
  }
  const v = p.roi(new cv.Rect(63, 1, 1, 1));
  try {
    // An array as long as a whole parent row: an out-of-bounds implementation takes all of
    // it, a correct one writes 1 element.
    v.replaceMatOnRow(new Array(64).fill(200), 0);
    assert.strictEqual(p.DATA()[127], 200);
    for (const m of neighbors) {
      assert.ok(
        Array.from(m.DATA()).every((x) => x === 7),
        "a neighbouring Mat's data changed; replaceMatOnRow wrote into somebody else's heap",
      );
    }
  } finally {
    v.delete();
    p.delete();
    for (const m of neighbors) m.delete();
  }
});
