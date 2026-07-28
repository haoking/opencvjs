"use strict";

/**
 * @haoking/opencvjs 主入口。
 *
 * 加载 emscripten glue，把手写扩展层挂到 cv.Mat.prototype / cv 上，返回就绪的 cv。
 *
 *   const cv = await require("@haoking/opencvjs")();          // 自动探测 SIMD
 *   const cv = await require("@haoking/opencvjs")({ simd: false });  // 强制 baseline
 *
 * ── 为什么 glue 在子目录里 ────────────────────────────────────────────────
 * dist/ 下有两份 wasm 产物：
 *
 *   dist/baseline/opencv.js + opencv_js.wasm   无 SIMD，任何环境都能跑
 *   dist/simd/opencv.js     + opencv_js.wasm   -msimd128 编译
 *
 * 它们**必须分目录**：两个变体的 .wasm 文件名都是编译期烘焙进 glue 的常量
 * "opencv_js.wasm"（详见 build/build.sh 顶部的长注释），改名会让运行时去 fetch
 * 一个不存在的路径。同名文件放同一目录必然互相覆盖，所以只能分目录，且每个
 * 目录里必须各放一份 glue，与同目录的 .wasm 原样配对——glue 在 Node 下按
 * __dirname 定位 .wasm。
 *
 * ⚠️ 这里曾经写着「两个变体的 glue 内容也不同，不能共用一份」。那是**错的**：
 * 实测两份 glue 逐字节相同（SHA-256 均为 da1f9d19…，各 143,365 B）。分目录的
 * 理由只有 .wasm 同名这一条。反过来也别依赖「它们永远相同」——同样没有依据。
 *
 * ── 变体怎么选 ────────────────────────────────────────────────────────────
 * 优先级：loadOpenCV({ simd })  >  环境变量 OPENCV_SIMD  >  运行时探测。
 * 规则与理由见 ./simd-detect.js 的 resolveVariant()。一句话：被**明确点名**的
 * 变体如果不存在就抛错，只有自动模式才回落到 baseline。
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
const { detectSimd, resolveVariant } = require("./simd-detect");

/**
 * 两条 require 都写成字面量路径，不用变量拼接。打包器（webpack / rollup /
 * esbuild）要能静态看见这两条依赖边才会把两个变体都打进产物；
 * `require("./" + variant + "/opencv.js")` 那种写法它们只能靠 context module
 * 猜，或者干脆漏掉一个。
 */
function requireGlue(variant) {
  return variant === "simd"
    ? require("./simd/opencv.js")
    : require("./baseline/opencv.js");
}

/**
 * 只认「就是这个 specifier 找不到」这一种错。
 *
 * 直接判 e.code === "MODULE_NOT_FOUND" 是不够的：glue 内部自己 require 别的东西
 * 失败时抛的也是这个 code，那种错误被当成「变体缺失」吞掉、静默换成 baseline，
 * 就成了一个查不出来的假象。Node 的报错文本里带的是**原样的 specifier**
 * （Cannot find module './simd/opencv.js'），嵌套失败给出的会是另一个名字。
 */
function isGlueMissing(e, variant) {
  return Boolean(
    e &&
    e.code === "MODULE_NOT_FOUND" &&
    typeof e.message === "string" &&
    e.message.includes(`./${variant}/opencv.js`),
  );
}

let warnedSimdFallback = false;

module.exports = async function loadOpenCV(options) {
  const choice = resolveVariant(options);
  let variant = choice.variant;

  let glue;
  try {
    glue = requireGlue(variant);
  } catch (e) {
    if (choice.source !== "probe") {
      // 被显式点名的变体不存在 —— 抛错，绝不悄悄换一个。
      // 「OPENCV_SIMD=1 跑一遍测试」如果实际跑的是 baseline，那份绿灯就是谎报，
      // 而这正是双产物一致性测试唯一的依靠。
      const how =
        choice.source === "option"
          ? `loadOpenCV({ simd: ${variant === "simd"} })`
          : `环境变量 OPENCV_SIMD`;
      throw new Error(
        `${how} 明确要求 ${variant} 变体，但 dist/${variant}/opencv.js 加载失败：` +
          `${(e && e.message) || e}\n` +
          `不会自动回落到另一个变体——那会让「强制 ${variant} 跑一遍」变成谎报。\n` +
          `补齐产物：build/build.sh${variant === "simd" ? " --simd" : ""} 后 npm run assemble`,
        { cause: e },
      );
    }
    if (variant !== "simd" || !isGlueMissing(e, "simd")) {
      throw e;
    }
    // 自动模式且 SIMD 变体确实不存在：回落到 baseline（它是回退产物，必然存在）。
    // 但要说出来。已发布的包里两个变体都在，这里能触发只有两种可能：本地只
    // assemble 了 baseline，或者打包器漏搬了 dist/simd/——两种都该让人知道，
    // 而不是让人以为自己在跑 SIMD。
    if (!warnedSimdFallback) {
      warnedSimdFallback = true;
      console.warn(
        "[@haoking/opencvjs] 运行时支持 SIMD，但 dist/simd/opencv.js 不存在，已回落到 baseline。" +
          "（设 OPENCV_SIMD=0 可显式选择 baseline 并静默此提示）",
      );
    }
    variant = "baseline";
    glue = requireGlue(variant);
  }

  const cv = await glue;

  if (typeof cv.Mat !== "function") {
    throw new Error(
      `OpenCV wasm 运行时未就绪（变体 ${variant}）：cv.Mat 不是构造函数` +
        `（不要用 cv.onRuntimeInitialized 判断就绪）`,
    );
  }

  // guards 先装：它要读 cv 的类型常量建表，并给 cv.matFromArray 套上长度校验；
  // 返回的校验器由后面三个模块在各自的函数入口使用。
  const guards = applyGuards(cv);

  // access.rawPtr 是给逐像素循环用的原生访问器查表：那些循环的下标已经由各自的
  // 入口校验证明合法，不必再逐像素走一遍 PTR() 的边界检查（那样要慢 1.8–2.1x，
  // 倍数以 npm run bench 的 inplace-ops 门禁输出为准）。
  const access = applyTypedAccess(cv, guards);

  applyMatRegion(cv, guards, access);
  applyArithmetic(cv, guards);
  applyDft(cv, guards);

  return cv;
};

/**
 * 当前运行时是否支持 WebAssembly SIMD。
 *
 * 暴露出来是为了让使用者能自己回答「我到底跑在哪个变体上」——排查性能问题时
 * 这是第一个要确认的事实。它只反映**引擎能力**，不反映最终加载了谁：
 * OPENCV_SIMD=0 时引擎照样支持 SIMD，但加载的是 baseline。
 */
module.exports.detectSimd = detectSimd;
