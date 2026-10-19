"use strict";

// Guards for the argument validation in src/js/guards.js.
//
// What these cases pin down is not "it throws" but **the shape of what is thrown**:
//
//   Before the guards, an out-of-range Rect made C++'s CV_Assert abort. The thrown value
//   depends on the emsdk version that built the artifact (details at the top of
//   src/js/guards.js):
//     emsdk 3.1.64  `throw <bare number>` — a heap pointer, not an error code (it changes
//                   with the variant and the allocation history: 1914504 on baseline,
//                   1955632 on simd, so no value is hard-coded). e instanceof Error is
//                   false and e.message is undefined, so a caller doing
//                   e.message.includes(...) crashes again (Cannot read properties of
//                   undefined).
//     emsdk 6.0.12  abort() throws a RuntimeError whose message is the same for every
//                   failure, "Aborted(undefined). Build with -sASSERTIONS for more
//                   info.", and prints an "Aborted(undefined)" line on stderr.
//   Neither helps locate the problem. The worse class (out-of-range rows and columns)
//   does not even abort: it silently rewrites somebody else's heap memory.
//
// So every case asserts three things: an Error subclass is thrown, it is the right one
// (TypeError or RangeError), and the message contains both **the value received** and
// **the expected set or range**. The last one matters most: an error message without the
// actual value is only a slightly less ugly abort.

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** 3×3 CV_32FC1 with values 1..9. */
function mat3(cv) {
  return cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

/**
 * Runs a call that must fail and returns what it threw, asserting right here that it is
 * an Error subclass. Every needle must appear in e.message.
 */
function assertGuard(fn, Ctor, needles, label) {
  let thrown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    thrown = e;
  }
  assert.ok(threw, `${label}: nothing was thrown; the check did not run`);
  assert.ok(
    thrown instanceof Error,
    `${label}: threw a ${typeof thrown} ${String(thrown)} instead of an Error ` +
      `(exactly the shape the guards exist to remove)`,
  );
  assert.ok(
    thrown instanceof Ctor,
    `${label}: expected ${Ctor.name}, got ${thrown.constructor.name}: ${thrown.message}`,
  );
  for (const needle of needles) {
    assert.ok(
      thrown.message.includes(needle),
      `${label}: the message lacks "${needle}"; actual message: ${thrown.message}`,
    );
  }
  return thrown;
}

// ---------------------------------------------------------------------------
// Premise: without validation, what a native failure throws says nothing.
//
// This is not filler — the whole case for the guards rests on it. It first asserted "a
// bare number is thrown"; upgrading to emsdk 6.0.12 made it fail as intended (the throw
// became a RuntimeError), and the premise was re-evaluated: the new throw is an Error,
// but its message is the same "Aborted(undefined)…" for every failure, so the case still
// holds. Both known shapes are accepted here — ci.yml may test artifacts from an earlier
// build, so both occur — and the message must **not** contain anything that locates the
// problem. If artifacts ever throw errors carrying OpenCV's assertion text (for
// instance with exception catching enabled), this fails and the premise needs another
// look.
// ---------------------------------------------------------------------------
test("premise: what native roi() throws when out of range says nothing", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  let thrown;
  let threw = false;
  try {
    mat.roi(new cv.Rect(1, 1, 10, 10));
  } catch (e) {
    threw = true;
    thrown = e;
  } finally {
    mat.delete();
  }

  assert.ok(
    threw,
    "native roi() did not throw when out of range; the guards' premise changed and needs another look",
  );
  const shape = `${typeof thrown} ${thrown && thrown.constructor && thrown.constructor.name}: ${
    thrown && thrown.message
  }`;
  if (typeof thrown === "number") {
    // emsdk 3.1.64: a bare heap pointer
    return;
  }
  assert.ok(
    thrown instanceof Error && /^Aborted\(/.test(thrown.message),
    `a native failure now throws ${shape}, which is neither known shape; the case for the guards needs another look`,
  );
  assert.ok(
    !/roi|Rect|Assertion|cv::|\(-215/.test(thrown.message),
    `the native failure's message now locates the problem (${thrown.message}); the case for the guards needs another look`,
  );
});

test("the module still works after an abort (the problem is the error, not a broken module)", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  try {
    mat.roi(new cv.Rect(1, 1, 10, 10));
  } catch (_) {
    /* the abort's throw, see the previous case; ignored */
  }
  const after = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  try {
    assert.deepStrictEqual(Array.from(after.DATA()), [1, 2, 3, 4]);
  } finally {
    mat.delete();
    after.delete();
  }
});

// ---------------------------------------------------------------------------
// Table-driven: every entry is a call that aborted or silently corrupted memory before
// the guards existed.
// ---------------------------------------------------------------------------
const CASES = [
  // Out-of-range Rects (before the guards: abort)
  {
    name: "roiClone with a Rect past the bottom-right edge",
    call: (cv, m) => m.roiClone(new cv.Rect(1, 1, 10, 10)),
    error: RangeError,
    needs: ["Mat.roiClone(rect)", "width=10", "cols=3", "rows=3"],
  },
  {
    name: "roiClone with a negative Rect coordinate",
    call: (cv, m) => m.roiClone(new cv.Rect(-1, 0, 2, 2)),
    error: RangeError,
    needs: ["x=-1", "0 ≤ x"],
  },
  {
    name: "roiClone given something that is not a Rect",
    call: (cv, m) => m.roiClone(undefined),
    error: TypeError,
    needs: ["Mat.roiClone(rect)", "undefined", "{x, y, width, height}"],
  },
  {
    name: "roiClone with a fractional Rect field",
    call: (cv, m) => m.roiClone({ x: 0, y: 0, width: 1.5, height: 2 }),
    error: TypeError,
    needs: ["must be integers", "number 1.5"],
  },
  // Out-of-range column / diagonal indices (before the guards: abort or a malformed Mat)
  {
    name: "colClone with an out-of-range column",
    call: (cv, m) => m.colClone(9),
    error: RangeError,
    needs: ["Mat.colClone(col)", "col = 9", "0..2"],
  },
  {
    name: "colClone with a fractional column (used to be truncated silently)",
    call: (cv, m) => m.colClone(1.5),
    error: TypeError,
    needs: ["col must be an integer", "number 1.5"],
  },
  {
    name: "diagClone with an out-of-range diagonal",
    call: (cv, m) => m.diagClone(4),
    error: RangeError,
    needs: ["Mat.diagClone(d)", "d = 4", "-2..2"],
  },
  // Out-of-range indices in in-place writes (before the guards: silent heap corruption)
  {
    name: "replaceMatOnRect with a Rect past the destination",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.replaceMatOnRect(src, new cv.Rect(2, 2, 2, 2));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.replaceMatOnRect(src, rect)", "x=2", "cols=3"],
  },
  {
    name: "replaceMatOnRect with a src smaller than the rect",
    call: (cv, m) => {
      const src = cv.matFromArray(1, 1, cv.CV_32FC1, [1]);
      try {
        m.replaceMatOnRect(src, new cv.Rect(0, 0, 3, 3));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["src is 1×1", "too small for the 3×3 region"],
  },
  {
    name: "replaceMatOnRect with a src that is not a Mat",
    call: (cv, m) => m.replaceMatOnRect({}, new cv.Rect(0, 0, 1, 1)),
    error: TypeError,
    needs: ["src must be a cv.Mat", "Object instance"],
  },
  {
    name: "rectAdd with a Rect past the destination",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.rectAdd(src, new cv.Rect(2, 2, 2, 2));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.rectAdd(src, rect)", "rows=3"],
  },
  {
    name: "rectSubtract with a Rect past the destination",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.rectSubtract(src, new cv.Rect(0, 0, 4, 1));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.rectSubtract(src, rect)", "width=4"],
  },
  {
    name: "replaceMatOnRow with an out-of-range row",
    call: (cv, m) => m.replaceMatOnRow([1, 2, 3], 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnRow(arr, row)", "row = 7", "0..2"],
  },
  {
    name: "replaceMatOnRow with a short array",
    call: (cv, m) => m.replaceMatOnRow([1], 0),
    error: RangeError,
    needs: ["arr has 1 element but 3 are needed"],
  },
  {
    name: "replaceMatOnCol with an out-of-range column",
    call: (cv, m) => m.replaceMatOnCol([1, 2, 3], 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnCol(arr, col)", "col = 7"],
  },
  {
    name: "replaceMatOnCol with a short array",
    call: (cv, m) => m.replaceMatOnCol([1], 0),
    error: RangeError,
    needs: ["arr has 1 element but 3 are needed"],
  },
  {
    name: "addOnCol with an out-of-range column",
    call: (cv, m) => m.addOnCol(1, 7),
    error: RangeError,
    needs: ["Mat.addOnCol(constant, col)", "col = 7"],
  },
  {
    name: "addOnCol with a constant that is not a number",
    call: (cv, m) => m.addOnCol(undefined, 0),
    error: TypeError,
    needs: ["constant must be a number", "undefined"],
  },
  {
    name: "replaceMatOnPoint with an out-of-range row and column",
    call: (cv, m) => m.replaceMatOnPoint(99, 7, 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnPoint(value, row, col)", "row = 7"],
  },
  {
    name: "replaceMatOnPoint with an out-of-range Point",
    call: (cv, m) => m.replaceMatOnPoint(99, new cv.Point(9, 0)),
    error: RangeError,
    needs: ["col = 9", "0..2"],
  },
  {
    name: "replaceMatOnPoint with a value that is not a number (data may be NaN, but must be a number)",
    call: (cv, m) => m.replaceMatOnPoint("1", 0, 0),
    error: TypeError,
    needs: [
      "Mat.replaceMatOnPoint(value, row, col)",
      "value must be a number",
      'string "1"',
    ],
  },
  // Constants of the scalar operations
  {
    name: "addConstant given undefined (used to produce a Mat full of NaN silently)",
    call: (cv, m) => m.addConstant(undefined),
    error: TypeError,
    needs: ["Mat.addConstant(constant)", "other than NaN", "undefined"],
  },
  {
    name: "mulConstant given NaN",
    call: (cv, m) => m.mulConstant(NaN),
    error: TypeError,
    needs: ["other than NaN", "number NaN"],
  },
  {
    name: "constantDivide given a string",
    call: (cv, m) => m.constantDivide("2"),
    error: TypeError,
    needs: ["other than NaN", 'string "2"'],
  },
  {
    name: "addOnCol with a NaN constant",
    call: (cv, m) => m.addOnCol(NaN, 0),
    error: TypeError,
    needs: ["Mat.addOnCol(constant, col)", "number NaN"],
  },
  {
    // The dividend is filled with a Scalar, which has only 4 components: a Mat with more
    // than 4 channels aborts in C++.
    name: "constantDivide on a 5-channel Mat (a Scalar cannot fill it; used to abort)",
    call: (cv) => {
      const planes = new cv.MatVector();
      const one = cv.matFromArray(1, 1, cv.CV_32FC1, [2]);
      const m5 = new cv.Mat();
      try {
        for (let k = 0; k < 5; k += 1) planes.push_back(one);
        cv.merge(planes, m5);
        m5.constantDivide(8);
      } finally {
        planes.delete();
        one.delete();
        m5.delete();
      }
    },
    error: TypeError,
    needs: ["Mat.constantDivide(constant)", "got 5 channels"],
  },
  // The row count of reshapeRows
  {
    name: "reshapeRows with a fractional row count (used to throw a RangeError)",
    call: (cv, m) => m.reshapeRows(1.5),
    error: TypeError,
    needs: ["Mat.reshapeRows(rows)", "rows must be an integer", "number 1.5"],
  },
  {
    name: "reshapeRows with a row count that does not divide the pixel count",
    call: (cv, m) => m.reshapeRows(4),
    error: RangeError,
    needs: [
      "Mat.reshapeRows(rows)",
      "the 9 pixels",
      "cannot be split evenly into 4 rows",
    ],
  },
  // norm2 with mismatched sizes / types (before the guards: cv.subtract aborts)
  {
    name: "norm2 with Mats of different sizes",
    call: (cv, m) => {
      const b = cv.matFromArray(1, 3, cv.CV_32FC1, [1, 2, 3]);
      try {
        cv.norm2(m, b);
      } finally {
        b.delete();
      }
    },
    error: RangeError,
    needs: ["cv.norm2(src1, src2, normType)", "src1 is 3×3", "src2 is 1×3"],
  },
  {
    name: "norm2 with Mats of different types",
    call: (cv, m) => {
      const b = cv.matFromArray(3, 3, cv.CV_8UC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      try {
        cv.norm2(m, b);
      } finally {
        b.delete();
      }
    },
    error: TypeError,
    needs: ["CV_32FC1", "CV_8UC1", "the types must match"],
  },
  {
    name: "norm2 given something that is not a Mat",
    call: (cv) => cv.norm2(1, 2),
    error: TypeError,
    needs: ["src1 must be a cv.Mat", "number 1"],
  },
  {
    name: "norm2 with a normType that is not a supported norm (used to abort)",
    call: (cv, m) => cv.norm2(m, m, 3),
    error: RangeError,
    needs: ["cv.norm2(src1, src2, normType)", "normType = 3"],
  },
  {
    name: "norm2 with NORM_HAMMING on something other than CV_8UC1 (used to abort)",
    call: (cv, m) => cv.norm2(m, m, cv.NORM_HAMMING),
    error: TypeError,
    needs: ["cv.norm2(src1, src2, normType)", "CV_8UC1", "CV_32FC1"],
  },
  // The channel count of dftSplit
  {
    name: "dftSplit on a multi-channel Mat (reads channel 0 only and silently returns garbage)",
    call: (cv) => {
      const m2 = cv.matFromArray(2, 2, cv.CV_32FC2, [1, 2, 3, 4, 5, 6, 7, 8]);
      try {
        m2.dftSplit();
      } finally {
        m2.delete();
      }
    },
    error: TypeError,
    needs: [
      "Mat.dftSplit()",
      "CV_32FC2",
      "accepts only 1-channel",
      "got 2 channels",
    ],
  },
  // The element count of matFromArray
  {
    name: "matFromArray with too few elements (used to return uninitialized heap memory silently)",
    call: (cv) => cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3]),
    error: RangeError,
    needs: ["cv.matFromArray", "needs 9 elements", "got 3"],
  },
  {
    name: "matFromArray counts elements per channel on multi-channel types",
    call: (cv) => cv.matFromArray(2, 2, cv.CV_32FC3, [1, 2, 3, 4]),
    error: RangeError,
    needs: ["CV_32FC3", "needs 12 elements", "2×2×3 channels"],
  },
  {
    name: "matFromArray with an array that is not an array",
    call: (cv) => cv.matFromArray(1, 1, cv.CV_32FC1, 5),
    error: TypeError,
    needs: ["array must be an array or a TypedArray", "number 5"],
  },
  {
    // The glue used to allocate the Mat before rejecting the type, leaking it on every call.
    name: "matFromArray with an unknown type (a misspelt constant is undefined)",
    call: (cv) => cv.matFromArray(2, 2, cv.CV_32FC5, [1, 2, 3, 4]),
    error: TypeError,
    needs: ["cv.matFromArray", "type must be", "type=undefined"],
  },
  {
    name: "matFromArray with a fractional row count",
    call: (cv) => cv.matFromArray(1.5, 2, cv.CV_8UC1, [1, 2, 3]),
    error: TypeError,
    needs: ["cv.matFromArray", "rows", "number 1.5"],
  },
  {
    name: "matFromArray with a negative column count",
    call: (cv) => cv.matFromArray(1, -2, cv.CV_8UC1, []),
    error: RangeError,
    needs: ["cols = -2", "must not be negative"],
  },
  // PTR's own bounds (it is documented public API; users call it directly, bypassing the
  // methods above)
  {
    name: "PTR(row, col) with both indices out of range",
    call: (cv, m) => m.PTR(9, 9),
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "row = 9", "0..2"],
  },
  {
    name: "PTR(row), the row form, out of range",
    call: (cv, m) => m.PTR(9),
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "row = 9", "0..2"],
  },
  {
    name: "PTR with only the column out of range",
    call: (cv, m) => m.PTR(0, 3),
    error: RangeError,
    needs: ["col = 3", "0..2"],
  },
  {
    name: "PTR with a negative row",
    call: (cv, m) => m.PTR(-1, 0),
    error: RangeError,
    needs: ["row = -1"],
  },
  {
    // Between 1.x and 2.0 col defaulted to -1 with a `col < 0` test, so PTR(0, -1) was
    // taken as "the whole row" instead of failing. The default is undefined now and every
    // negative column is reported as out of range.
    name: "PTR with a negative column (the old code took -1 as the whole-row sentinel)",
    call: (cv, m) => m.PTR(0, -1),
    error: RangeError,
    needs: ["col = -1", "0..2"],
  },
  {
    name: "PTR with a fractional row (used to be truncated to row 1 silently)",
    call: (cv, m) => m.PTR(1.5, 0),
    error: TypeError,
    needs: ["row must be an integer", "number 1.5"],
  },
  {
    name: "PTR with a fractional column",
    call: (cv, m) => m.PTR(0, 1.5),
    error: TypeError,
    needs: ["col must be an integer", "number 1.5"],
  },
  {
    name: "PTR on an empty Mat",
    call: (cv) => {
      const empty = new cv.Mat();
      try {
        empty.PTR(0, 0);
      } finally {
        empty.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "the Mat is empty in this dimension"],
  },
];

for (const c of CASES) {
  test(`guards: ${c.name}`, async () => {
    const cv = await getCv();
    const mat = mat3(cv);
    try {
      assertGuard(() => c.call(cv, mat), c.error, c.needs, c.name);
    } finally {
      mat.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// Deleted Mats.
//
// Unlike the cases above, Embind already throws a BindingError here (an Error with a
// readable message), so what the guards add is not catchability but the half Embind
// cannot say: which argument of which function. Both are pinned below.
// ---------------------------------------------------------------------------
test("guards: calling an extension method on a deleted Mat names the function and the argument", async () => {
  const cv = await getCv();
  const dead = mat3(cv);
  dead.delete();

  const calls = [
    ["Mat.roiClone(rect)", () => dead.roiClone(new cv.Rect(0, 0, 1, 1))],
    ["Mat.colClone(col)", () => dead.colClone(0)],
    ["Mat.diagClone(d)", () => dead.diagClone()],
    ["Mat.sum()", () => dead.sum()],
    ["Mat.reshapeRows(rows)", () => dead.reshapeRows(1)],
    ["Mat.addConstant(constant)", () => dead.addConstant(1)],
    ["Mat.dftSplit()", () => dead.dftSplit()],
    ["Mat.addOnCol(constant, col)", () => dead.addOnCol(1, 0)],
  ];
  for (const [where, fn] of calls) {
    assertGuard(fn, TypeError, [where, "the receiver has been deleted"], where);
  }
});

test("guards: a deleted Mat as the second argument is reported by name", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const dead = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  dead.delete();
  try {
    assertGuard(
      () => mat.replaceMatOnRect(dead, new cv.Rect(0, 0, 2, 2)),
      TypeError,
      ["Mat.replaceMatOnRect(src, rect)", "src has been deleted"],
      "replaceMatOnRect(dead src)",
    );
    assertGuard(
      () => cv.norm2(mat, dead),
      TypeError,
      ["cv.norm2(src1, src2, normType)", "src2 has been deleted"],
      "norm2(dead src2)",
    );
  } finally {
    mat.delete();
  }
});

// ---------------------------------------------------------------------------
// The checks must stop only real errors: no valid call may be rejected.
// (Correctness across all types and channels is covered by test/types and the rest of
// test/unit; this pins only inputs right on the boundaries, where checks are easiest to
// get wrong.)
// ---------------------------------------------------------------------------
test("guards: valid inputs on the boundaries are not affected", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const kept = [];
  try {
    // A Rect covering the whole Mat
    kept.push(mat.roiClone(new cv.Rect(0, 0, 3, 3)));
    // An empty Rect, which OpenCV allows
    kept.push(mat.roiClone(new cv.Rect(1, 1, 0, 0)));
    // The last column and the outermost diagonals
    kept.push(mat.colClone(2));
    kept.push(mat.diagClone(2));
    kept.push(mat.diagClone(-2));
    // The last row / the last pixel
    mat.replaceMatOnRow([1, 2, 3], 2);
    mat.replaceMatOnPoint(0, 2, 2);
    mat.addOnCol(0, 2);
    // Negative constants and 0 are finite numbers
    kept.push(mat.addConstant(-1.5));
    kept.push(mat.mulConstant(0));

    assert.strictEqual(kept[0].rows, 3);
    assert.strictEqual(kept[1].rows, 0, "an empty Rect gives an empty Mat");
    // colClone was copied before the replaceMatOnRow below, so it is still the original
    // column 2
    assert.deepStrictEqual(Array.from(kept[2].DATA()), [3, 6, 9]);

    // Both valid forms of PTR, and indices on the boundary.
    // Row 2 of mat now holds what replaceMatOnRow([1,2,3], 2) wrote, and
    // replaceMatOnPoint(0, 2, 2) then set (2,2) to 0; addConstant / mulConstant return
    // new Mats and leave the source alone.
    assert.deepStrictEqual(Array.from(mat.PTR(2)), [1, 2, 0]);
    assert.deepStrictEqual(Array.from(mat.PTR(2, 2)), [0]);
    assert.deepStrictEqual(Array.from(mat.PTR(0, 0)), [1]);
    // Passing undefined explicitly is the same as omitting it (the row form)
    assert.deepStrictEqual(Array.from(mat.PTR(2, undefined)), [1, 2, 0]);
  } finally {
    mat.delete();
    for (const m of kept) m.delete();
  }
});

// ---------------------------------------------------------------------------
// ±Infinity must be accepted.
//
// This was a real false rejection: guards.number was first written as `Number.isFinite`
// for brevity, rejecting ±Infinity along with NaN. But ±Infinity is a valid IEEE-754
// value that worked before the guards existed (addConstant(Infinity) gave all Infinity
// on the pre-guard artifacts), and it is the standard sentinel in cost and distance
// maps. Rejecting a correct use is the worst mistake this layer can make.
//
// The difference from NaN is deliberate: as an **operand** NaN has no legitimate use; it
// wipes out the whole Mat at once, which usually means something upstream already went
// wrong.
// ---------------------------------------------------------------------------
test("guards: ±Infinity is a valid operand and must not be rejected", async () => {
  const cv = await getCv();
  const mk = () => cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  const out = [];
  try {
    const a = mk();
    out.push(a);
    const r1 = a.addConstant(Infinity);
    out.push(r1);
    assert.deepStrictEqual(Array.from(r1.DATA()), [
      Infinity,
      Infinity,
      Infinity,
      Infinity,
    ]);

    const r2 = a.mulConstant(-Infinity);
    out.push(r2);
    assert.deepStrictEqual(Array.from(r2.DATA()), [
      -Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ]);

    const b = mk();
    out.push(b);
    b.addOnCol(Infinity, 0);
    assert.deepStrictEqual(Array.from(b.DATA()), [Infinity, 2, Infinity, 4]);

    const c = mk();
    out.push(c);
    c.replaceMatOnPoint(-Infinity, 0, 0);
    assert.deepStrictEqual(Array.from(c.DATA()), [-Infinity, 2, 3, 4]);

    // NaN is still rejected: the two boundaries were decided separately, not as a side
    // effect of isFinite
    const d = mk();
    out.push(d);
    assert.throws(() => d.addConstant(NaN), TypeError);
  } finally {
    for (const m of out) m.delete();
  }
});

test("guards: NaN / Infinity written as data are not restricted (operands versus data)", async () => {
  const cv = await getCv();
  const mat = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  try {
    // Arrays are checked for length, not element values: writing NaN into a pixel to
    // mean "invalid here" is legitimate. The asymmetry is deliberate; do not "unify" it
    // away in a later change.
    mat.replaceMatOnRow([Infinity, NaN], 0);
    // replaceMatOnPoint writes one element of data too (it once rejected NaN as if it
    // were an operand; fixed).
    mat.replaceMatOnPoint(NaN, 1, 1);
    const got = Array.from(mat.DATA());
    assert.strictEqual(got[0], Infinity);
    assert.ok(Number.isNaN(got[1]));
    assert.strictEqual(got[2], 3);
    assert.ok(Number.isNaN(got[3]));
  } finally {
    mat.delete();
  }
});

test("guards: an array element that cannot be converted fails the call before anything is written", async () => {
  const cv = await getCv();
  const m = cv.matFromArray(2, 2, cv.CV_8UC1, [1, 2, 3, 4]);
  try {
    // `+x` throws for a BigInt or a Symbol. Converting while writing left the Mat
    // half-written: [7, 8n] used to write the 7 before failing on the 8n.
    for (const [where, call] of [
      ["Mat.replaceMatOnRow(arr, row)", () => m.replaceMatOnRow([7, 8n], 0)],
      [
        "Mat.replaceMatOnCol(arr, col)",
        () => m.replaceMatOnCol([7, Symbol("x")], 0),
      ],
    ]) {
      assertGuard(
        call,
        TypeError,
        [where, "arr[1]", "nothing was written"],
        where,
      );
      assert.deepStrictEqual(
        Array.from(m.DATA()),
        [1, 2, 3, 4],
        `${where} wrote part of the array`,
      );
    }
    // Elements that do convert keep working on the slow path: numeric strings, and NaN
    // mixed in (it saturates to 0 on an integer Mat).
    m.replaceMatOnRow(["9", NaN], 1);
    assert.deepStrictEqual(Array.from(m.DATA()), [1, 2, 9, 0]);
  } finally {
    m.delete();
  }
});

// ---------------------------------------------------------------------------
// The in-place writes validate their indices **on entry** and then address the wasm heap
// directly (access.pixels()) instead of going through PTR() per pixel. These two cases
// pin both ends of that split.
// ---------------------------------------------------------------------------
test("guards: in-place writes report their own name, not Mat.PTR", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  try {
    // The entry check must fire before any PTR call; otherwise the message degrades to
    // Mat.PTR(...) and the caller cannot tell which API was misused.
    const cases = [
      ["Mat.addOnCol(constant, col)", () => mat.addOnCol(1, 7)],
      [
        "Mat.replaceMatOnCol(arr, col)",
        () => mat.replaceMatOnCol([1, 2, 3], 7),
      ],
      [
        "Mat.replaceMatOnRow(arr, row)",
        () => mat.replaceMatOnRow([1, 2, 3], 7),
      ],
      [
        "Mat.replaceMatOnPoint(value, row, col)",
        () => mat.replaceMatOnPoint(1, 7, 7),
      ],
      [
        "Mat.replaceMatOnRect(src, rect)",
        () => mat.replaceMatOnRect(src, new cv.Rect(2, 2, 2, 2)),
      ],
      [
        "Mat.rectAdd(src, rect)",
        () => mat.rectAdd(src, new cv.Rect(2, 2, 2, 2)),
      ],
      [
        "Mat.rectSubtract(src, rect)",
        () => mat.rectSubtract(src, new cv.Rect(2, 2, 2, 2)),
      ],
    ];
    for (const [where, fn] of cases) {
      const e = assertGuard(fn, RangeError, [where], where);
      assert.ok(
        !e.message.includes("Mat.PTR"),
        `${where}: the error came from PTR rather than the entry check; message: ${e.message}`,
      );
    }
  } finally {
    mat.delete();
    src.delete();
  }
});

test("guards: per-pixel loops do not go through PTR() (that would be two extra Embind calls per pixel)", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const src = cv.matFromArray(2, 2, cv.CV_32FC1, [10, 20, 30, 40]);
  const realPTR = cv.Mat.prototype.PTR;
  // Replace PTR with a tripwire: touching it once in a loop throws. It is the only way to
  // observe whether a loop goes through PTR, and exactly what a later change could
  // quietly bring back — going through PTR makes these methods two orders of magnitude
  // slower (see the gate output of test/bench/inplace-ops.bench.js).
  cv.Mat.prototype.PTR = function () {
    throw new Error("PTR() was called in a loop");
  };
  try {
    mat.replaceMatOnRect(src, new cv.Rect(1, 1, 2, 2));
    mat.rectAdd(src, new cv.Rect(1, 1, 2, 2));
    mat.rectSubtract(src, new cv.Rect(1, 1, 2, 2));
    mat.replaceMatOnCol([1, 2, 3], 0);
    mat.addOnCol(1, 0);
    // By hand: [1..9] → replaceMatOnRect sets (1,1)(1,2)(2,1)(2,2) to 10,20,30,40
    // → rectAdd adds them again → rectSubtract takes them off → replaceMatOnCol writes
    // 1,2,3 into column 0 → addOnCol adds 1 to each element of column 0.
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [2, 2, 3, 3, 10, 20, 4, 30, 40],
      "the result is wrong once PTR is bypassed",
    );
  } finally {
    cv.Mat.prototype.PTR = realPTR;
    mat.delete();
    src.delete();
  }
});

// ---------------------------------------------------------------------------
// rect can be any object with getters. An implementation that reads it once to validate
// and again to address can see two different values: validation sees a valid width, the
// write uses an out-of-range one and rewrites the heap past dst's data. This case makes
// width read 1 the first two times (enough to fool guards.rect and guards.covers) and 64
// afterwards.
// ---------------------------------------------------------------------------
test("guards: each rect field is read once, so validation and the write see the same values", async () => {
  const cv = await getCv();
  const dst = cv.matFromArray(1, 4, cv.CV_8UC1, [0, 0, 0, 0]);
  const src = cv.matFromArray(1, 4, cv.CV_8UC1, [9, 9, 9, 9]);
  const reads = { x: 0, y: 0, width: 0, height: 0 };
  const shiftyRect = () => {
    for (const k of Object.keys(reads)) reads[k] = 0;
    return {
      get x() {
        reads.x += 1;
        return 0;
      },
      get y() {
        reads.y += 1;
        return 0;
      },
      get width() {
        reads.width += 1;
        return reads.width <= 2 ? 1 : 64;
      },
      get height() {
        reads.height += 1;
        return 1;
      },
    };
  };
  const off = dst.data.byteOffset;
  const tail = () => Array.from(cv.HEAPU8.subarray(off + 4, off + 64));
  const before = tail();
  const kept = [];
  try {
    for (const [where, call] of [
      ["replaceMatOnRect", (r) => dst.replaceMatOnRect(src, r)],
      ["rectAdd", (r) => dst.rectAdd(src, r)],
      ["rectSubtract", (r) => dst.rectSubtract(src, r)],
      ["roiClone", (r) => kept.push(dst.roiClone(r))],
    ]) {
      call(shiftyRect());
      assert.deepStrictEqual(
        reads,
        { x: 1, y: 1, width: 1, height: 1 },
        `${where}: a rect field was read more than once`,
      );
      assert.deepStrictEqual(
        tail(),
        before,
        `${where}: heap bytes after dst's data were rewritten; the write did not use the validated width`,
      );
    }
    assert.strictEqual(
      kept[0].cols,
      1,
      "roiClone should use the validated width = 1",
    );
  } finally {
    dst.delete();
    src.delete();
    for (const m of kept) m.delete();
  }
});

test("guards: loading again neither stacks matFromArray wrappers nor wraps PTR twice", async () => {
  const path = require("path");
  const { DIST } = require("../helpers");
  // loadOpenCV() can run more than once (two modules each writing
  // await require(...)() are enough), and cv is the same object in the require cache. The
  // prototype extensions are naturally idempotent; only matFromArray is a wrapper and
  // would stack without a guard.
  const loadCV = require(path.join(DIST, "index.js"));
  const cv = await loadCV();
  const first = cv.matFromArray;
  const firstPTR = cv.Mat.prototype.PTR;
  await loadCV();
  assert.strictEqual(
    cv.matFromArray,
    first,
    "the second load wrapped matFromArray again",
  );
  assert.strictEqual(cv.matFromArray.guarded, true);
  // PTR's check lives in the function body rather than in a wrapper, so loading again
  // only reassigns it: idempotent, no stacked checks, identical behaviour.
  assert.strictEqual(
    typeof cv.Mat.prototype.PTR,
    "function",
    "PTR is gone after loading again",
  );
  const probe = cv.matFromArray(2, 2, cv.CV_8UC1, [1, 2, 3, 4]);
  try {
    assert.throws(
      () => probe.PTR(9, 9),
      RangeError,
      "PTR's bounds check stopped working after loading again",
    );
  } finally {
    probe.delete();
  }
  assert.strictEqual(
    firstPTR.length,
    cv.Mat.prototype.PTR.length,
    "PTR's parameter count changed after loading again; it may have been wrapped",
  );
  // The wrapper still works, and valid calls are unaffected
  assert.throws(() => cv.matFromArray(2, 2, cv.CV_8UC1, [1]), RangeError);
  const m = cv.matFromArray(2, 2, cv.CV_8UC1, [1, 2, 3, 4]);
  try {
    assert.deepStrictEqual(Array.from(m.DATA()), [1, 2, 3, 4]);
  } finally {
    m.delete();
  }
});

test("guards: after stopping a bad call, the Mat and the module are intact", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  try {
    assert.throws(() => mat.replaceMatOnRect(mat, new cv.Rect(2, 2, 2, 2)));
    assert.throws(() => mat.addOnCol(NaN, 0));
    assert.throws(() => mat.colClone(99));

    // Not a single byte changed: validation completes before any write
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      "a call that failed validation must not have written anything",
    );
    // Later valid calls work as usual
    mat.replaceMatOnPoint(99, 1, 1);
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 3, 4, 99, 6, 7, 8, 9],
    );
  } finally {
    mat.delete();
  }
});

test("guards: when dftSplit throws on an empty Mat, it releases the two Mats it allocated", async () => {
  const cv = await getCv();
  // dftSplit first zeros() a real and an imaginary Mat, then writes element by element;
  // on an empty Mat the first write throws a RangeError. zeros is wrapped to record every
  // Mat it allocates, and each is checked for release after the throw — the only way to
  // observe a wasm heap leak from JS.
  const realZeros = cv.Mat.zeros;
  const made = [];
  const tracked = function zeros(...args) {
    const m = realZeros.apply(this, args);
    made.push(m);
    return m;
  };
  // Embind's overload dispatcher reads cv.Mat.zeros.overloadTable back, so the
  // replacement must carry it along.
  Object.assign(tracked, realZeros);
  cv.Mat.zeros = tracked;
  const empty = new cv.Mat(0, 3, cv.CV_32FC1);
  try {
    assert.throws(() => empty.dftSplit(), RangeError);
    assert.ok(
      made.length > 0,
      "premise: dftSplit should have allocated its output Mats first",
    );
    assert.ok(
      made.every((m) => m.isDeleted()),
      `after dftSplit threw, ${made.filter((m) => !m.isDeleted()).length} Mat(s) were not released`,
    );
  } finally {
    cv.Mat.zeros = realZeros;
    empty.delete();
    for (const m of made) if (!m.isDeleted()) m.delete();
  }
});
