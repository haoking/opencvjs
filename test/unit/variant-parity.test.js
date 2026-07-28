"use strict";

// baseline 与 simd 两个变体的**数值一致性**。
//
// ── 为什么需要这一条 ──────────────────────────────────────────────────────
// 「SIMD 版本能跑」和「SIMD 版本算得对」是两件事。CI 会带 OPENCV_SIMD=1 把整套
// 测试在 SIMD 变体上再跑一遍，那证明的是「同一套断言在两个变体上都成立」；
// 本文件补的是另一半：把同一份输入喂给两份产物，逐元素比较输出。断言全过但
// 两边数字不同（各自都落在断言的容差里）这种情况，只有这样才查得出来。
//
// 这也是 -msimd128 唯一真正的风险面：SIMD 内核是另一份手写代码，与标量路径走
// 的不是同一条分支。
//
// ── 为什么走子进程 ────────────────────────────────────────────────────────
// 两个变体不能在同一个进程里同时加载 —— OpenCV 的 UMD 外壳把 Module 泄漏成了
// 隐式全局变量，第二个变体会撞上第一个的 embind 注册表。完整的机理、实测结论
// 与替代方案写在 test/variant-cases.js 顶部。
//
// ── 跳过与强制 ────────────────────────────────────────────────────────────
// 本地通常只 assemble 了 baseline（构 SIMD 要 Docker），此时整组跳过。
// 但在「本来就该有两个变体」的场合，跳过必须变成失败——判据是
// OPENCV_PARITY_REQUIRED=1，与 test/smoke/wasm-artifact.test.js 的
// OPENCV_SMOKE_REQUIRED 同一个套路：门禁报绿却什么都没查，比没有门禁更糟。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { DIST } = require("../helpers");
const { CASES } = require("../variant-cases");

const RUNNER = path.join(__dirname, "..", "variant-cases.js");
const SIMD_GLUE = path.join(DIST, "simd", "opencv.js");
const HAS_SIMD = fs.existsSync(SIMD_GLUE);

if (!HAS_SIMD && process.env.OPENCV_PARITY_REQUIRED === "1") {
  throw new Error(
    `OPENCV_PARITY_REQUIRED=1 但 ${SIMD_GLUE} 不存在 —— ` +
      `双产物一致性是「SIMD 版本没算错」的唯一保证，静默跳过等于不查。` +
      `先 npm run assemble <baseline 目录> <simd 目录>。`,
  );
}

const skip = HAS_SIMD ? false : "dist/simd/ 不存在（本地通常只构了 baseline）";

// ── 浮点用例的判据 ────────────────────────────────────────────────────────
//
//     max|a − b|  <=  TOL × max(‖baseline‖∞, 1)
//
// 也就是**按整幅数据的量级归一的绝对差**，不是逐元素相对差。公式与常数都直接取自
// OpenCV 自己的测试框架，不是我们凭空定的：
//
//   modules/imgproc/test/test_filter.cpp
//     CV_PyramidBaseTest::get_success_error_level() → CV_32F 时 1e-5
//     CV_PyramidBaseTest : CV_FilterBaseTest，而后者构造函数里
//     element_wise_relative_error = false
//   modules/ts/src/ts_func.cpp  cmpEps()
//     if (refarr.depth() >= CV_32F && !element_wise_relative_error)
//         maxval = norm(refarr, NORM_INF);  maxval = MAX(maxval, 1.);
//     ...
//     threshold = element_wise_relative_error ? fabs(b_val) + 1 : maxval;
//     if (fabs(a_val - b_val) > threshold * success_err_level) → 失败
//
// 上游同族算子的 success_err_level（全部 element_wise_relative_error = false）：
//   pyrDown / blur / GaussianBlur 1e-5，filter2D 1e-4，Sobel 5e-4。
// 这里统一取 **1e-5**，即其中最严的那个——对本表里每一个算子都比上游更严，
// 所以「按操作分档」在这里只会放松，没有意义。
//
// ── 为什么不用逐元素相对差（这条曾经写错过）────────────────────────────────
// 本文件最初用的是 |a−b| / max(|a|,|b|,1e-6)，并且注释里写着「能容下末位一两个
// ulp」。首次真实 SIMD 构建（run 30379642633）下它在 pyrDown 32FC4 上报出
// 7.00e-5 的偏差，看起来像是 752 ulp、比声称的「一两个 ulp」大两个数量级。
//
// 查下来是**判据错了，不是 SIMD 错了**。用真实产物做的定量分析（把 pyrDown 的
// 5×5 核 [1,4,6,4,1]/16 + BORDER_REFLECT_101 用 double 重算一遍当真值，
// 与两个变体逐元素对比）：
//
//   触发失败的那个元素 idx 2104
//     baseline   0.010001882910728455
//     simd       0.010001182556152344
//     双精度参照 0.010000599548220634   ← 用 double 累加同一个 5×5 核算出的真值
//     |baseline − 真值| = 1.283e-6      |simd − 真值| = 5.830e-7
//   该像素累加过程中的量级 Σ|w·x| = 47.80，而输出只有 0.010 ——
//   **输出仅为累加量级的 0.021%，是一次几乎完全的抵消。**
//
// 误差是在 ~47.8 这个量级上产生的，却被拿 0.01 去除——分母小了 4800 倍，于是
// 1.6 ulp 被放大成「752 ulp」。以累加量级为分母重新度量，两个变体的最大误差是
// baseline 1.9 ulp / simd 1.6 ulp，正是原注释所说的「一两个 ulp」。
//
// 相关性也对得上：按旧判据偏差最大的前 10 个元素，抵消率中位数 0.121%；
// 全体元素的抵消率中位数是 19.128%。**旧判据挑出来的正是抵消最狠的那些点。**
//
// 而且 SIMD 在每一项聚合指标上都**更接近真值**，不是更远：
//   RMS 误差        baseline 1.199e-6   simd 9.721e-7
//   更接近真值的元素 baseline 1111 个    simd 1544 个（相同 1441 个）
//   最大误差(ulp)   baseline 1.9        simd 1.6
// 有数值缺陷的实现会系统性地偏离双精度真值，这里的方向恰好相反。
//
// 结论：pyrDown 的差异是浮点累加顺序不同造成的正常离散，SIMD 侧甚至略优。
// 判据换成上游的那一条，而不是把旧判据的阈值调松——后者会让这条断言从
// 「SIMD 没算错」退化成「SIMD 错得不太多」。
//
// ── 这条判据的已知弱点 ────────────────────────────────────────────────────
// 分母是整幅数据的 ‖·‖∞，所以对「输出动态范围极大」的算子（例如 DFT 的 DC 项远大于
// 高频项），量级很小的那些元素即使相对误差很大也能过。上游有同样的性质。本表的
// 输入固定在 [−100,100)，各用例输出量级 O(1)–O(10³)，`MAX(maxval, 1.)` 那个下限
// 从不生效。真要收紧得给每个算子写双精度参照实现，成本远超收益——双产物一致性
// 的主力保证是「同一套 205 项断言在两个变体上各跑一遍」，本文件是补充而非替代。
const TOL = 1e-5;

test(
  "两个变体的 wasm 二进制确实不同 —— --simd 没有被静默丢掉",
  { skip },
  (t) => {
    const sha = (p) =>
      crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const baseWasm = path.join(DIST, "baseline", "opencv_js.wasm");
    const simdWasm = path.join(DIST, "simd", "opencv_js.wasm");

    t.diagnostic(
      `baseline ${fs.statSync(baseWasm).size} B / simd ${fs.statSync(simdWasm).size} B`,
    );
    // 这是**必要条件，不是充分条件**：两份二进制不同并不证明里面真有 v128 指令
    // （证明那件事要完整解析 wasm，超出本测试范围）。但它能挡住最现实的那种故障
    // ——--simd 被上游改名/移除/静默忽略，于是两条构建路径产出逐字节相同的东西，
    // 而所有断言照样全绿、报告照样宣称「SIMD 变体已验证」。
    assert.notStrictEqual(
      sha(baseWasm),
      sha(simdWasm),
      "baseline 与 simd 的 opencv_js.wasm 逐字节相同 —— --simd 很可能没生效",
    );
  },
);

test(
  "baseline 与 simd 两个变体的输出一致",
  { skip, timeout: 180000 },
  async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencvjs-parity-"));
    const out = {};
    try {
      for (const v of ["baseline", "simd"]) {
        const f = path.join(tmp, `${v}.json`);
        execFileSync(process.execPath, [RUNNER, v, f], {
          stdio: ["ignore", "inherit", "inherit"],
          env: { ...process.env, OPENCV_DIST: DIST },
        });
        out[v] = JSON.parse(fs.readFileSync(f, "utf8"));
      }

      // 先把 14 个用例全部算完，最后一次性断言。
      //
      // 不在第一个不合格的用例上就抛：首次真实 SIMD 构建时正是 pyrDown 先抛，
      // 于是排在它后面的 Sobel / dft / 两个扩展层用例一个都没跑，报告里看不出
      // 「其余算子到底是全对还是也有问题」——而那恰恰是判断「个别算子的浮点离散」
      // 还是「SIMD 整体有缺陷」最需要的信息。收集完再断言，一次就能看到全貌。
      const failures = [];
      for (const c of CASES) {
        const a = out.baseline[c.name];
        const b = out.simd[c.name];
        assert.ok(Array.isArray(a) && Array.isArray(b), `${c.name}: 缺少结果`);
        assert.strictEqual(a.length, b.length, `${c.name}: 输出长度不同`);
        assert.ok(a.length > 0, `${c.name}: 输出为空，这个用例什么都没测`);

        let maxAbs = 0;
        let at = -1;
        let normInf = 0;
        let nDiff = 0;
        for (let i = 0; i < a.length; i += 1) {
          if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
            failures.push(
              `${c.name}: 第 ${i} 个元素不是有限数 baseline=${a[i]} simd=${b[i]}`,
            );
            at = -2;
            break;
          }
          const d = Math.abs(a[i] - b[i]);
          if (d !== 0) nDiff += 1;
          if (d > maxAbs) {
            maxAbs = d;
            at = i;
          }
          const m = Math.abs(a[i]);
          if (m > normInf) normInf = m;
        }
        if (at === -2) continue;

        if (c.exact) {
          // 整数内核与扩展层：没有舍入可言，任何差异都是 bug。
          if (maxAbs !== 0) {
            failures.push(
              `${c.name}: 第 ${at} 个元素不同 baseline=${a[at]} simd=${b[at]}（本用例要求逐位相同）`,
            );
          }
          continue;
        }

        const threshold = TOL * Math.max(normInf, 1);
        // 无论过不过都把数字打出来：「逐位相同」和「差 1.3e-7」是两个不同的事实，
        // 只报一个「通过」会把它丢掉。逐位相同与否是**构建相关**的偶然性质
        // （本轮 14 个用例里 12 个逐位相同），所以只报告、不断言——一旦哪天不再
        // 相同，CI 日志里看得见，但不会因此误报失败。
        t.diagnostic(
          `${c.name}: ${nDiff === 0 ? "逐位相同" : `${nDiff}/${a.length} 元素不同`}` +
            `  max|a-b|=${maxAbs.toExponential(2)}` +
            `  ‖ref‖∞=${normInf.toExponential(2)}` +
            `  判据=${(maxAbs / Math.max(normInf, 1)).toExponential(2)}` +
            `  阈值=${TOL.toExponential(0)}` +
            (maxAbs > 0
              ? `  余量 ${(threshold / maxAbs).toFixed(0)}x`
              : "  余量 ∞"),
        );
        if (maxAbs > threshold) {
          failures.push(
            `${c.name}: max|a-b| = ${maxAbs.toExponential(3)} 超过 ` +
              `${TOL} × max(‖ref‖∞,1) = ${threshold.toExponential(3)}` +
              `（最大差在第 ${at} 个元素 baseline=${a[at]} simd=${b[at]}）`,
          );
        }
      }

      assert.deepStrictEqual(
        failures,
        [],
        `双产物输出不一致（共 ${failures.length} 项）:\n  ${failures.join("\n  ")}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
