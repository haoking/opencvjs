"use strict";

const path = require("path");

/**
 * 被测对象是**组装后的 dist/**，也就是用户 `npm install` 之后拿到的那份代码：
 * CI 构建的 wasm 产物（opencv.js glue + opencv_js.wasm）加上 src/js/ 的扩展层。
 * 不直接 require src/js/index.js —— 那份代码在 src/ 下没有同目录的 glue，
 * require("./opencv.js") 会失败；而且直接测 src/ 也测不到组装这一步。
 *
 * dist/ 不入 git（.gitignore），先跑 `npm run assemble` 生成。
 * OPENCV_DIST 可指向别处的 dist 布局（例如直接测 CI 下载下来的目录）。
 */
const DIST = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");

const DEPTHS = ["8U", "8S", "16U", "16S", "32S", "32F", "64F"];
const CHANNELS = [1, 2, 3, 4];

let cached = null;

/**
 * 加载并缓存 cv。
 *
 * ⚠️ 新产物的入口返回 Promise，且 await 之后 `cv.onRuntimeInitialized` 这个属性
 * **依然存在**（实测 typeof 为 function）。用它判断是否就绪会恒真，从而去等一个
 * 永不再触发的回调 —— 首次 CI 冒烟测试正是栽在这上面。就绪判据只看 cv.Mat。
 *
 * dist/ 缺失时**抛错，不跳过**：跳过会让整套测试静默地从 113 项掉到 0 项并且
 * 退出码仍是 0，这正是本仓库一路在清理的失败模式。
 */
async function getCv() {
  if (cached) return cached;

  const entry = path.join(DIST, "index.js");
  let loadCV;
  try {
    loadCV = require(entry);
  } catch (e) {
    throw new Error(
      `无法加载 ${entry}：${describeError(e)}\n` +
        `dist/ 由 build/assemble.sh 组装且不入 git。先执行:\n` +
        `  npm run assemble [wasm 产物目录]\n` +
        `（产物目录默认 build/out/baseline，即 build/build.sh 的输出位置）`,
    );
  }

  const cv = await loadCV();
  if (typeof cv.Mat !== "function") {
    throw new Error("cv.Mat 不是构造函数 —— wasm 运行时未就绪");
  }
  cached = cv;
  return cv;
}

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
function makeMat(cv, depth, channels) {
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

/**
 * 调用被测的区域操作。
 *
 * 2.0 起这三个方法叫 roiClone / colClone / diagClone —— 1.x 把修复直接盖在原生
 * roi()/col()/diag() 上，代价是原生的视图语义被静默改掉；2.0 不再覆盖原生方法。
 */
function callRegion(cv, mat, api) {
  if (api === "roi") return mat.roiClone(new cv.Rect(1, 1, 2, 2));
  if (api === "col") return mat.colClone(2);
  if (api === "diag") return mat.diagClone();
  throw new Error(`unknown api: ${api}`);
}

module.exports = {
  DIST,
  getCv,
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
};
