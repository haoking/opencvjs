"use strict";

// 一个进程里只能加载一个变体——请求另一个变体时，必须在碰到它的 glue 之前就拦下。
//
// OpenCV 的 UMD 外壳把 Module 泄漏成隐式全局变量（机理见 test/variant-cases.js 顶部）。
// 第二个变体的 glue 一旦被 require，会先把自己的 JS 辅助函数写到**第一个实例**上，
// 然后才在 embind 注册时抛 "Cannot register public name 'IntVector' twice"。实测第一个
// 实例的 cv.matFromArray 因此被换掉，长度校验静默丢失——文档记载的「会抛错」是真的，
// 但抛错之前已经把已加载的那个实例弄坏了。
//
// 本文件自己控制加载顺序，不走 helpers.getCv()；node --test 每个文件一个进程，
// 这里的加载不会影响别的测试文件。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { DIST } = require("../helpers");

const loadCV = require(path.join(DIST, "index.js"));
const { parseEnvSimd } = require(path.join(DIST, "simd-detect.js"));

test("已加载 baseline 后显式要求 simd：加载前就抛错，已加载的实例完好", async () => {
  const cv = await loadCV({ simd: false });

  await assert.rejects(loadCV({ simd: true }), (e) => {
    assert.ok(
      e instanceof Error && e.name === "Error",
      `应抛普通 Error，实际是 ${e && e.name}: ${e && e.message}`,
    );
    assert.match(e.message, /已经加载了 baseline 变体/);
    return true;
  });

  // 第一个实例的守卫仍在：短数组照样被拦下，而不是产出未初始化的堆内存。
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

test("已加载某个变体后，不点名的调用沿用它（环境变量点了别的变体则抛错）", async () => {
  const cv = await loadCV({ simd: false });
  const fromEnv = parseEnvSimd(process.env.OPENCV_SIMD);
  if (fromEnv === true) {
    // OPENCV_SIMD=1 是显式点名，与已加载的 baseline 冲突：抛错，不悄悄换。
    await assert.rejects(loadCV(), /环境变量 OPENCV_SIMD 要求 simd 变体/);
  } else {
    // 未设置（自动模式）或 OPENCV_SIMD=0：拿到的就是已加载的同一个实例。
    assert.strictEqual(await loadCV(), cv);
  }
});
