"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { cv, DEPTHS, CHANNELS, makeMat } = require("../helpers");

// 上游 OpenCV 曾因 PR #26643 让 clone() 静默退化为浅拷贝，持续约 12 个月无人
// 发现（2024-12 引入，2025-07 才由外部用户报告）。本仓库的 roi/col/Diag 全部
// 建立在 clone() 之上（见 opencv.js 的 cloneAndRelease），因此不能假定它正确
// —— 必须有测试在它退化时立刻报警。
for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    test(`clone() 对 CV_${depth}C${channels} 是深拷贝`, () => {
      const { mat } = makeMat(depth, channels);
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

test("区域操作的返回值不与源 Mat 共享内存", () => {
  const { mat } = makeMat("32F", 1);
  const region = mat.roi(new cv.Rect(1, 1, 2, 2));

  try {
    const before = Array.from(region.DATA());

    const src = mat.DATA();
    for (let i = 0; i < src.length; i += 1) src[i] = 0; // 清空源

    assert.deepStrictEqual(
      Array.from(region.DATA()),
      before,
      "roi() 返回值与源共享内存 —— 源被改动后区域数据跟着变了",
    );
  } finally {
    mat.delete();
    region.delete();
  }
});
