"use strict";

/**
 * WebAssembly SIMD 运行时探测，以及「加载哪个变体」的决策。
 *
 * 本模块**不碰文件系统、不加载 wasm**——它只回答两个问题：这个引擎支不支持
 * SIMD；按照优先级规则该选哪个变体。真正的 require 与回退在 index.js 里。
 * 拆开是为了让探测本身可以被单测直接覆盖，不必先加载 8.5 MB 的 wasm。
 */

/**
 * 探测用的最小 wasm 模块，31 字节，逐字节含义如下。
 *
 *   00 61 73 6d          magic  "\0asm"
 *   01 00 00 00          version 1
 *   01 05                section 1 (Type)，长度 5
 *     01                   1 个类型
 *     60 00 01 7b          func () -> (v128)      ← 0x7b 是 v128 值类型
 *   03 02                section 3 (Function)，长度 2
 *     01 00                1 个函数，类型索引 0
 *   0a 0a                section 10 (Code)，长度 10
 *     01                   1 个函数体
 *     08                   函数体 8 字节
 *     00                   0 组局部变量声明
 *     41 00                i32.const 0
 *     fd 0f                i8x16.splat            ← 0xfd 是 SIMD 前缀
 *     fd 62                i8x16.popcnt
 *     0b                   end
 *
 * 三个刻意的选择：
 *
 * ① 用 WebAssembly.validate() 而不是 compile()/instantiate()。validate 是同步的
 *    （返回 boolean 而非 Promise），而 loadOpenCV 的变体决策必须在 require 之前
 *    就完成——异步探测会逼着入口先 await 一次才知道该 require 谁。
 *
 * ② 结果类型取 v128：这让整个模块的合法性依赖于引擎认识 SIMD 值类型。已实测
 *    把这个字节从 7b 改成 7f(i32)，validate 立刻返回 false——也就是说 v128 是
 *    承重的，不是装饰。同时一个把 v128 换成 i32、函数体也相应换成 i32.const 的
 *    「同构标量模块」validate 为 true，证明除 SIMD 之外的外壳部分本身合法：
 *    不支持 SIMD 的引擎返回 false 只可能是因为 SIMD，不是因为模块写错了。
 *
 * ③ 结尾用 i8x16.popcnt（0xfd 0x62）而不是就此收手。popcnt 是 SIMD 提案定稿阶段
 *    才加进去的指令，只实现了早期草案 SIMD 的引擎会在这里 false。这是有意的
 *    保守：本项目的 SIMD 产物由 -msimd128 编译，目标是定稿版指令集，对只懂草案
 *    的引擎回落到 baseline 才是正确行为。（这也是 wasm-feature-detect 选它的理由。）
 *
 * 已验证（node v22.22.2 / darwin-arm64）：validate(本模块) === true。
 * false 分支无法在支持 SIMD 的引擎上直接复现，改由上面 ② 的两个变体模块间接
 * 证明——见 test/unit/simd-detect.test.js。
 */
// 不 Object.freeze()：对非空 TypedArray 调用 freeze 会抛
// `TypeError: Cannot freeze array buffer views with elements`（已实测，node v22）。
// 想避免被篡改就 .slice() 一份，测试里正是这么做的。
// prettier-ignore
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

/**
 * 未记忆化的原始探测。测试用它反复调用；生产走下面记忆化的 detectSimd()。
 *
 * WebAssembly 全局在极老的运行时里可能不存在（本包 engines 要求 node >= 18，
 * 那里一定有；但浏览器打包场景无法保证），所以先 typeof 一下。任何异常都当作
 * 「不支持」——探测函数自己抛错会把一个可回退的情况变成加载失败。
 */
function probeSimd() {
  if (typeof WebAssembly === "undefined" || !WebAssembly.validate) {
    return false;
  }
  try {
    return WebAssembly.validate(SIMD_PROBE) === true;
  } catch {
    return false;
  }
}

let cachedProbe = null;

/** 记忆化的探测：同一进程内引擎能力不会变，没必要反复算。 */
function detectSimd() {
  if (cachedProbe === null) {
    cachedProbe = probeSimd();
  }
  return cachedProbe;
}

/** 仅供测试：清掉记忆化结果。 */
function resetSimdCache() {
  cachedProbe = null;
}

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

/**
 * 解析 OPENCV_SIMD。无法识别的值**抛错，不是忽略**：把 OPENCV_SIMD=ture 静默
 * 当成「未设置」，用户会以为自己强制了 SIMD，实际跑的是探测结果——那正是
 * 本仓库一路在清的「以为查了、其实没查」。
 */
function parseEnvSimd(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  throw new TypeError(
    `OPENCV_SIMD 的值无法识别: ${JSON.stringify(raw)}。` +
      `可用值: ${[...TRUTHY].join("/")}（强制 SIMD）或 ${[...FALSY].join("/")}（强制 baseline）；` +
      `不设置则按运行时探测自动选择。`,
  );
}

/**
 * 决定加载哪个变体。纯函数，不看文件系统。
 *
 * 优先级：显式 options.simd  >  环境变量 OPENCV_SIMD  >  运行时探测
 *
 * @param {{simd?: boolean}} [options]
 * @param {Record<string, string|undefined>} [env] 默认 process.env
 * @returns {{variant: "simd"|"baseline", source: "option"|"env"|"probe"}}
 *
 * source 是**能不能回退**的判据，index.js 靠它区分两种情况：
 *   - "option" / "env"：用户明确点名了一个变体。此时若该变体不存在，必须抛错。
 *     悄悄换成另一个会让「OPENCV_SIMD=1 跑一遍测试」这件事变成谎报——测的是
 *     baseline，报告说测了 SIMD。
 *   - "probe"：自动模式。SIMD 变体缺失时回落到 baseline 是正确行为（baseline
 *     一定存在，它是回退产物）。
 */
function resolveVariant(options, env) {
  const opts = options === undefined || options === null ? {} : options;
  if (typeof opts !== "object") {
    throw new TypeError(
      `loadOpenCV(options) 的 options 必须是对象，收到 ${typeof opts}`,
    );
  }

  if (opts.simd !== undefined) {
    if (typeof opts.simd !== "boolean") {
      throw new TypeError(
        `loadOpenCV({ simd }) 只接受 boolean，收到 ${typeof opts.simd}`,
      );
    }
    return { variant: opts.simd ? "simd" : "baseline", source: "option" };
  }

  const environment =
    env || (typeof process !== "undefined" ? process.env : {}) || {};
  const fromEnv = parseEnvSimd(environment.OPENCV_SIMD);
  if (fromEnv !== undefined) {
    return { variant: fromEnv ? "simd" : "baseline", source: "env" };
  }

  return { variant: detectSimd() ? "simd" : "baseline", source: "probe" };
}

module.exports = {
  SIMD_PROBE,
  probeSimd,
  detectSimd,
  resetSimdCache,
  parseEnvSimd,
  resolveVariant,
};
