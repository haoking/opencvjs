"use strict";

/**
 * @haoking/opencvjs 主入口。
 *
 * 加载 emscripten glue（同目录的 opencv.js + opencv_js.wasm），把手写扩展层
 * 挂到 cv.Mat.prototype / cv 上，返回就绪的 cv。
 *
 *   const cv = await require("@haoking/opencvjs")();
 *
 * ⚠️ 就绪判据只能看 typeof cv.Mat === "function"。新产物 require() 返回
 * Promise，await 之后 cv.onRuntimeInitialized 属性**依然存在**，用它判断就绪
 * 会恒真 —— 首次 wasm 构建的冒烟测试就栽在这上面。
 */

const applyGuards = require("./guards");
const applyTypedAccess = require("./typed-access");
const applyMatRegion = require("./mat-region");
const applyArithmetic = require("./arithmetic");
const applyDft = require("./dft");

module.exports = async function loadOpenCV() {
  const cv = await require("./opencv.js");

  if (typeof cv.Mat !== "function") {
    throw new Error(
      "OpenCV wasm 运行时未就绪：cv.Mat 不是构造函数（不要用 cv.onRuntimeInitialized 判断就绪）",
    );
  }

  // guards 先装：它要读 cv 的类型常量建表，并给 cv.matFromArray 套上长度校验；
  // 返回的校验器由后面三个模块在各自的函数入口使用。
  const guards = applyGuards(cv);

  applyTypedAccess(cv);
  applyMatRegion(cv, guards);
  applyArithmetic(cv, guards);
  applyDft(cv, guards);

  return cv;
};
