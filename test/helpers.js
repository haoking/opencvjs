"use strict";

const path = require("path");
const cv = require(path.join(__dirname, "..", "opencv.js"));

const DEPTHS = ["8U", "8S", "16U", "16S", "32S", "32F", "64F"];
const CHANNELS = [1, 2, 3, 4];

/**
 * emscripten 在异常被编译掉的构建下抛出的是数字（如 6446944），不是 Error 实例。
 * 直接读 e.message 会得到 undefined，对它做字符串操作会让测试代码自身崩溃，
 * 并把这个自伤伪装成 "cv 模块已报废"。所有捕获点必须走这个函数。
 *
 * e 是对象且带 message 属性时取 message（不论其类型——{message: 123} 应产出
 * "123"，而不是退化成 String(e) 的 "[object Object]"）；否则退回 String(e)，
 * 覆盖数字、字符串、null、undefined 等非对象抛出物。两个分支都只返回字符串，
 * 不会再抛出。
 */
function describeError(e) {
  if (e !== null && typeof e === "object" && e.message !== undefined) {
    return String(e.message);
  }
  return String(e);
}

/** 构造 3x3 测试矩阵，值为 1..9*channels，按 OpenCV 交错布局排列。 */
function makeMat(depth, channels) {
  const typeName = `CV_${depth}C${channels}`;
  const type = cv[typeName];
  if (type === undefined) {
    throw new Error(`unknown cv type: ${typeName}`);
  }
  const data = [];
  for (let i = 1; i <= 9 * channels; i += 1) {
    data.push(i);
  }
  return { mat: cv.matFromArray(3, 3, type, data), data, typeName };
}

/**
 * 独立计算期望值 —— 不调用任何被测代码，否则测试会跟着实现一起错。
 * data 为 3x3xC 交错数组，px(r,c) 取该像素的 C 个通道值。
 */
function expectedRegion(api, data, channels) {
  const px = (r, c) =>
    data.slice((r * 3 + c) * channels, (r * 3 + c + 1) * channels);
  if (api === "roi") {
    // Rect(x=1, y=1, w=2, h=2) → 行 1..2 × 列 1..2
    return [...px(1, 1), ...px(1, 2), ...px(2, 1), ...px(2, 2)];
  }
  if (api === "col") {
    return [...px(0, 2), ...px(1, 2), ...px(2, 2)];
  }
  if (api === "diag") {
    return [...px(0, 0), ...px(1, 1), ...px(2, 2)];
  }
  throw new Error(`unknown api: ${api}`);
}

/** 调用被测的区域操作。 */
function callRegion(mat, api) {
  if (api === "roi") return mat.roi(new cv.Rect(1, 1, 2, 2));
  if (api === "col") return mat.col(2);
  if (api === "diag") return mat.Diag();
  throw new Error(`unknown api: ${api}`);
}

module.exports = {
  cv,
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
};
