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

// 浮点用例的相对误差上限。1e-5 远小于任何有意义的算法差异，又能容下 float32
// 末位一两个 ulp —— SIMD 内核改变累加与乘加的结合顺序是规范允许的。
const TOL = 1e-5;

/** 相对误差；两边完全相等时为 0。 */
function relDiff(x, y) {
  if (x === y) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  const scale = Math.max(Math.abs(x), Math.abs(y), 1e-6);
  return Math.abs(x - y) / scale;
}

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

      for (const c of CASES) {
        const a = out.baseline[c.name];
        const b = out.simd[c.name];
        assert.ok(Array.isArray(a) && Array.isArray(b), `${c.name}: 缺少结果`);
        assert.strictEqual(a.length, b.length, `${c.name}: 输出长度不同`);
        assert.ok(a.length > 0, `${c.name}: 输出为空，这个用例什么都没测`);

        let worst = 0;
        let at = -1;
        for (let i = 0; i < a.length; i += 1) {
          const d = c.exact
            ? a[i] === b[i]
              ? 0
              : Infinity
            : relDiff(a[i], b[i]);
          if (d > worst) {
            worst = d;
            at = i;
          }
        }

        if (c.exact) {
          assert.strictEqual(
            worst,
            0,
            `${c.name}: 第 ${at} 个元素不同 baseline=${a[at]} simd=${b[at]}（本用例要求逐位相同）`,
          );
        } else {
          // 把实测最大偏差打出来：它是 0 还是 3e-7，是两个完全不同的事实，
          // 只报「通过」会把这个信息丢掉。
          t.diagnostic(`${c.name}: 最大相对偏差 ${worst.toExponential(2)}`);
          assert.ok(
            worst <= TOL,
            `${c.name}: 第 ${at} 个元素相对偏差 ${worst.toExponential(3)} 超过 ${TOL}` +
              `（baseline=${a[at]} simd=${b[at]}）`,
          );
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
