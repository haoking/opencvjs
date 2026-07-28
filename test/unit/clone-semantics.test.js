"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { getCv, DEPTHS, CHANNELS, makeMat } = require("../helpers");

// 上游 OpenCV 曾因 PR #26643 让 clone() 静默退化为浅拷贝，持续约 12 个月无人
// 发现（2024-12 引入，2025-07 才由外部用户报告）。本仓库的 roiClone/colClone/
// diagClone 全部建立在 clone() 之上（见 src/js/mat-region.js 的 cloneAndRelease），
// 因此不能假定它正确 —— 必须有测试在它退化时立刻报警。
for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    test(`clone() 对 CV_${depth}C${channels} 是深拷贝`, async () => {
      const cv = await getCv();
      const { mat } = makeMat(cv, depth, channels);
      const copy = mat.clone();

      try {
        const before = Array.from(copy.DATA());
        const src = mat.DATA();
        // 改源。data[0] 恒为 1，+100 = 101，落在 CV_8S 的 -128..127 范围内，
        // 不会溢出（溢出不影响测试是否失效，但会让失败信息难以判读）。
        src[0] = src[0] + 100;

        assert.deepStrictEqual(
          Array.from(copy.DATA()),
          before,
          `clone() 退化为浅拷贝：改源 Mat 后副本跟着变了`,
        );
      } finally {
        mat.delete();
        copy.delete();
      }
    });
  }
}

// 这条用例同时钉住 2.0 的两半语义：修复版是副本，**且**原生方法没有被覆盖。
// 1.x 只有前一半——它把修复直接盖在原生 roi() 上，于是原生的视图语义被静默
// 改掉，`mat.roi(r).setTo(...)` 写不回源 Mat 且不报错。
test("roiClone() 返回独立副本，原生 roi() 仍是视图", async () => {
  const cv = await getCv();
  const { mat } = makeMat(cv, "32F", 1);
  const region = mat.roiClone(new cv.Rect(1, 1, 2, 2));
  const view = mat.roi(new cv.Rect(1, 1, 2, 2));

  try {
    const before = Array.from(region.DATA());

    const src = mat.DATA();
    for (let i = 0; i < src.length; i += 1) src[i] = 0; // 清空源

    assert.deepStrictEqual(
      Array.from(region.DATA()),
      before,
      "roiClone() 返回值与源共享内存 —— 源被改动后区域数据跟着变了",
    );

    // 3x3 CV_32FC1 上 Rect(1,1,2,2) 覆盖 (1,1)(1,2)(2,1)(2,2) → 下标 4,5,7,8
    view.setTo(new cv.Scalar(7, 7, 7, 7));
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [0, 0, 0, 0, 7, 7, 0, 7, 7],
      "原生 roi() 不再写回源 Mat —— 2.0 不应覆盖原生方法",
    );
  } finally {
    mat.delete();
    region.delete();
    view.delete();
  }
});
