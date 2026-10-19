"use strict";

// The MCC (Macbeth ColorChecker) bindings: bound under their real 5.0.0 class names
// (change 4 in src/config/opencv_js.config.py, plus build/patches/opencv-js-mcc-bindings.patch)
// and usable end to end. The chart is drawn synthetically, so its position and patch
// colours are known exactly.

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** sRGB values of the 24 patches of a Macbeth ColorChecker, row by row. */
const MACBETH = [
  [115, 82, 68],
  [194, 150, 130],
  [98, 122, 157],
  [87, 108, 67],
  [133, 128, 177],
  [103, 189, 170],
  [214, 126, 44],
  [80, 91, 166],
  [193, 90, 99],
  [94, 60, 108],
  [157, 188, 64],
  [224, 163, 46],
  [56, 61, 150],
  [70, 148, 73],
  [175, 54, 60],
  [231, 199, 31],
  [187, 86, 149],
  [8, 133, 161],
  [243, 243, 242],
  [200, 200, 200],
  [160, 160, 160],
  [122, 122, 121],
  [85, 85, 85],
  [52, 52, 52],
];

/** A 640×460 BGR image holding an MCC24 chart: 80-pixel patches, 96 pixels apart, on a dark frame. */
function drawChart(cv) {
  const img = new cv.Mat(460, 640, cv.CV_8UC3, new cv.Scalar(128, 128, 128, 0));
  cv.rectangle(
    img,
    new cv.Point(20, 20),
    new cv.Point(620, 440),
    new cv.Scalar(20, 20, 20, 0),
    -1,
  );
  MACBETH.forEach(([r, g, b], i) => {
    const x = 40 + (i % 6) * 96;
    const y = 40 + Math.floor(i / 6) * 96;
    cv.rectangle(
      img,
      new cv.Point(x, y),
      new cv.Point(x + 80, y + 80),
      new cv.Scalar(b, g, r, 0),
      -1,
    );
  });
  return img;
}

/**
 * Leaves 0xFF bytes in freed heap chunks of many sizes, so an object allocated next reads
 * garbage in any member its constructor does not initialize. Fresh wasm memory is zeroed,
 * which would hide such a member.
 */
function dirtyHeap(cv) {
  const mats = [];
  for (let n = 16; n <= 2048; n += 16) {
    mats.push(new cv.Mat(1, n, cv.CV_8UC1, new cv.Scalar(255, 0, 0, 0)));
  }
  for (const m of mats) m.delete();
}

test("the MCC classes and the chart type enum are bound", async () => {
  const cv = await getCv();
  for (const name of [
    "mcc_CCheckerDetector",
    "mcc_CChecker",
    "mcc_DetectorParametersMCC",
  ]) {
    assert.strictEqual(typeof cv[name], "function", `cv.${name} is missing`);
  }
  assert.deepStrictEqual(
    [
      cv.mcc_ColorChart.MCC24.value,
      cv.mcc_ColorChart.SG140.value,
      cv.mcc_ColorChart.VINYL18.value,
    ],
    [0, 1, 2],
  );
});

test("a new detector defaults to MCC24 and finds the chart without any setter", async () => {
  // CCheckerDetectorImpl used to leave its chart type uninitialized
  // (build/patches/opencv-mcc-chart-type-init.patch): a detector never given
  // setColorChartType() read leftover heap memory and detected nothing.
  const cv = await getCv();
  const img = drawChart(cv);
  dirtyHeap(cv);
  const det = new cv.mcc_CCheckerDetector();
  try {
    assert.strictEqual(
      det.getColorChartType(),
      cv.mcc_ColorChart.MCC24,
      "a new detector's chart type is not MCC24 (uninitialized member?)",
    );
    assert.strictEqual(det.process(img, 1), true, "the chart was not found");
  } finally {
    det.delete();
    img.delete();
  }
});

test("the detected chart reports its position and the exact patch colours", async () => {
  const cv = await getCv();
  const img = drawChart(cv);
  const det = new cv.mcc_CCheckerDetector();
  det.setColorChartType(cv.mcc_ColorChart.MCC24);
  let checker = null;
  const owned = [];
  try {
    assert.strictEqual(det.process(img, 1), true, "the chart was not found");
    checker = det.getBestColorChecker();
    assert.strictEqual(checker.getTarget(), cv.mcc_ColorChart.MCC24);

    const box = checker.getBox();
    owned.push(box);
    assert.strictEqual(box.size(), 4, "the box should have 4 corners");
    // The chart (frame and patches) spans x 20..620, y 20..440.
    const center = checker.getCenter();
    assert.ok(
      Math.abs(center.x - 320) < 10 && Math.abs(center.y - 230) < 10,
      `centre (${center.x}, ${center.y}) is far from the drawn chart's (320, 230)`,
    );

    // Mean RGB per patch: the patch interiors are uniform, so the means are the drawn values.
    const means = checker.getChartsRGB(false);
    owned.push(means);
    assert.strictEqual(means.rows, 24);
    assert.strictEqual(means.type(), cv.CV_64FC3);
    const got = Array.from(means.data64F);
    MACBETH.flat().forEach((want, k) => {
      assert.ok(
        Math.abs(got[k] - want) <= 1,
        `patch ${Math.floor(k / 3)} channel ${k % 3}: mean ${got[k]}, drawn ${want}`,
      );
    });

    // With statistics: one row per patch and channel; columns are pixel count, mean,
    // standard deviation, minimum and maximum.
    const stats = checker.getChartsRGB(true);
    owned.push(stats);
    assert.deepStrictEqual([stats.rows, stats.cols], [72, 5]);
    const row0 = Array.from(stats.data64F.subarray(0, 5));
    assert.ok(row0[0] > 0, "pixel count");
    assert.deepStrictEqual(row0.slice(1), [115, 0, 115, 115]);
  } finally {
    for (const m of owned) m.delete();
    if (checker) checker.delete();
    det.delete();
    img.delete();
  }
});

test("detection parameters can be set", async () => {
  const cv = await getCv();
  const img = drawChart(cv);
  const det = new cv.mcc_CCheckerDetector();
  try {
    const params = new cv.mcc_DetectorParametersMCC();
    assert.strictEqual(typeof params.minImageSize, "number");
    params.minImageSize = 500;
    det.setColorChartType(cv.mcc_ColorChart.MCC24);
    det.setDetectionParams(params);
    assert.strictEqual(det.process(img, 1), true);
  } finally {
    det.delete();
    img.delete();
  }
});

test("processWithROI searches only the given rectangles", async () => {
  const cv = await getCv();
  const img = drawChart(cv);
  const det = new cv.mcc_CCheckerDetector();
  const covering = new cv.RectVector();
  const elsewhere = new cv.RectVector();
  try {
    covering.push_back(new cv.Rect(0, 0, 640, 460));
    elsewhere.push_back(new cv.Rect(560, 380, 80, 80));
    assert.strictEqual(det.processWithROI(img, covering, 1), true);
    assert.strictEqual(det.processWithROI(img, elsewhere, 1), false);
  } finally {
    covering.delete();
    elsewhere.delete();
    det.delete();
    img.delete();
  }
});

test("the members that cannot be bound are absent, and create(net) fails clearly", async () => {
  const cv = await getCv();
  const det = new cv.mcc_CCheckerDetector();
  try {
    // getListColorChecker() / draw() use std::vector<Ptr<CChecker>>, which Embind cannot
    // pass; getDetectionParams() returns a const reference embindgen cannot wrap.
    for (const name of ["getListColorChecker", "draw", "getDetectionParams"]) {
      assert.strictEqual(
        det[name],
        undefined,
        `${name} is bound now; update the README's MCC section`,
      );
    }
  } finally {
    det.delete();
  }
  // dnn has no JS bindings, so the create(const dnn::Net&) overload cannot be called.
  assert.throws(
    () => new cv.mcc_CCheckerDetector({}),
    /Cannot construct mcc_CCheckerDetector due to unbound types/,
  );
});
