"use strict";

// 就地写入类操作的性能回归门禁。
//
// ── 这个门禁防的是什么 ────────────────────────────────────────────────────────
// replaceMatOnRect / rectAdd / rectSubtract / replaceMatOnCol / addOnCol 这几个方法
// 是逐像素写入的。它们**不调用 Mat.PTR()**：下标范围已经由各自的入口 guards 一次性
// 证明合法，循环里用的是 typed-access 的 rawPtr() 在循环外取到的原生访问器名。
//
// 「图省事直接在循环里调 PTR()」是随时可能被写回去的改动 —— 代码更短、行为也完全
// 正确，只是慢。慢多少：PTR() 自己要查边界，而边界要读 this.rows / this.cols，那是
// **两个 embind getter**，每次读取都是一次跨语言调用。本文件每次运行都会把这个倍数
// 打印在「退化参照（循环调 PTR）」那一行上，本机实测落在 **1.8–2.1x**。
//
// ⚠️ 别把这个倍数抄进别处的注释再各自漂移 —— 源码里曾经同时存在 38% / 82% / 105%
// 三种说法（分别来自三组口径不同的对照），互相差到一倍。要引用就引用本门禁的输出。
//
// ── 为什么 region-ops.bench.js 覆盖不到 ──────────────────────────────────────
// 那个门禁测的是 roiClone()，而 roiClone() 内部是「原生 roi + clone」，**根本不经过
// PTR，也不逐像素循环**。把上面这几个方法的循环改回调 PTR，它照样一路绿灯。也就是
// 说，在本文件出现之前，一次约 2x 的退化能悄悄合进主干。这正是本项目一直在清的
// 「会说谎的绿灯」，所以补上这个门禁。
//
// ── 门禁的形状（与直觉相反的一点）────────────────────────────────────────────
// 直觉的写法是「对照组 = 循环调 PTR 的版本，阈值 1.5×」。**那是无效的**，方向反了：
// 被测实现比对照组快一倍，比值恒在 0.5 附近；真有人把循环改回 PTR，比值升到 1.0，
// 距离 1.5 的阈值还远得很 —— 门禁照样打印「达标」。用第七节那组实测数据验算过：
//
//   现状 actual=176.73  对照=362.01  阈值 543.0  → PASS（对）
//   退化 actual=362.01  对照=362.01  阈值 543.0  → PASS（错，本该 FAIL）
//
// 所以对照组取的是**「循环走原生访问器」的参照实现**（和 region-ops.bench.js 一样：
// 拿被测实现所封装的那个原语当基准），阈值 baseline × 1.5：
//
//   现状 actual=176.73  对照=176.73  阈值 265.1  → PASS
//   退化 actual=362.01  对照=176.73  阈值 265.1  → FAIL ✔
//
// 这个形状还更稳：它对「循环变慢」这件事本身报警，不只针对 PTR 这一种写法。
// 「循环调 PTR」的版本仍然每轮都测，但只作为参照打印出来 —— 它同时用来检查本门禁
// **还有没有鉴别力**，见下面 MIN_DISCRIMINATION 那段。
//
// 测量方法与 region-ops.bench.js 一致：三个版本逐轮轮换起跑顺序、丢弃第 1 轮（JIT
// 分层编译与 embind 调用桥的一次性预热会被先跑的那一方整体付掉，是测量顺序造成的
// 伪影）、取第 2 轮起的最小值。
const { getCv } = require("../helpers");

const SIZE = 64; // 源图 64×64 CV_32FC1
const RECT = { x: 1, y: 1, width: 32, height: 32 };
const ROUNDS = 4; // 第 1 轮是预热轮，丢弃；取第 2..4 轮的最小值

// 被测实现相对参照实现允许的倍数。region-ops.bench.js 用的也是 1.5，理由相同：
// 两者做的是同一件事，比值理应接近 1x，留 50% 给测量噪声。
const LIMIT_FACTOR = 1.5;

// 「循环调 PTR」的版本至少要比参照实现慢这么多，本门禁才有鉴别力可言 —— 因为
// LIMIT_FACTOR 是 1.5，如果 PTR 版本只慢 20%，那么把循环改回 PTR 也过得了门禁。
// 实测这个比值是 1.9–2.1，余量充足。真跌到 1.5 以下就要发声，而不是继续报绿：
// 那意味着 embind getter 变便宜了（门禁失去意义，该删或该重新定标），或者被测实现
// 已经在偷偷做等价的事。
const MIN_DISCRIMINATION = 1.5;

// ROUNDS < 2 时 rounds.slice(1) 是空数组，Math.min() 返回 Infinity，阈值随之变成
// Infinity，`actual > LIMIT` 恒为 false —— 门禁会永远打印「✅ 性能达标」而实际什么
// 都没查。当前 ROUNDS 是常量且无外部入口，触发不了，但这正是「门禁报绿却什么都没
// 查」的模板，先把它堵死。（用 console.error + process.exit 而不是 throw：门禁要的
// 是明确的退出码，不是一段栈回溯。理由详见 region-ops.bench.js 同一处注释。）
if (ROUNDS < 2) {
  console.error(
    `❌ ROUNDS 必须 >= 2（当前 ${ROUNDS}）：第 1 轮是预热轮要丢弃，` +
      `少于 2 轮时 Math.min(...[]) === Infinity，阈值失效、门禁恒为通过。`,
  );
  process.exit(1);
}

/** 复刻 typed-access.js 的 depth → 原生访问器映射，供参照实现使用。 */
function ptrTable(cv) {
  const table = [];
  for (const [depth, method] of [
    [cv.CV_8U, "ucharPtr"],
    [cv.CV_8S, "charPtr"],
    [cv.CV_16U, "ushortPtr"],
    [cv.CV_16S, "shortPtr"],
    [cv.CV_32S, "intPtr"],
    [cv.CV_32F, "floatPtr"],
    [cv.CV_64F, "doublePtr"],
  ]) {
    table[depth] = method;
  }
  return table;
}

function measure(n, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function main() {
  const cv = await getCv();
  const TABLE = ptrTable(cv);
  const raw = (mat) => TABLE[mat.depth()];

  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  const mat = cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
  const src = cv.matFromArray(
    RECT.height,
    RECT.width,
    cv.CV_32FC1,
    new Array(RECT.height * RECT.width).fill(1),
  );
  const rect = new cv.Rect(RECT.x, RECT.y, RECT.width, RECT.height);
  const colArr = new Array(SIZE).fill(2);

  // 每个用例三份实现：
  //   reference —— 参照：循环外取一次原生访问器（= 被测实现该有的样子），作为基准
  //   actual    —— 被测：dist/ 里真正发布的那个方法
  //   viaPTR    —— 退化参照：循环里逐像素调 PTR()（本门禁要防的写法）
  const CASES = [
    {
      name: "replaceMatOnRect 32×32",
      n: 1500,
      reference() {
        const d = raw(mat);
        const s = raw(src);
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat[d](i + rect.y, j + rect.x)[0] = src[s](i, j)[0];
          }
        }
      },
      actual: () => mat.replaceMatOnRect(src, rect),
      viaPTR() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat.PTR(i + rect.y, j + rect.x)[0] = src.PTR(i, j)[0];
          }
        }
      },
    },
    {
      name: "rectAdd 32×32",
      n: 1500,
      reference() {
        const d = raw(mat);
        const s = raw(src);
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat[d](rect.y + i, rect.x + j)[0] += src[s](i, j)[0];
          }
        }
      },
      actual: () => mat.rectAdd(src, rect),
      viaPTR() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat.PTR(rect.y + i, rect.x + j)[0] += src.PTR(i, j)[0];
          }
        }
      },
    },
    {
      name: "rectSubtract 32×32",
      n: 1500,
      reference() {
        const d = raw(mat);
        const s = raw(src);
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat[d](rect.y + i, rect.x + j)[0] -= src[s](i, j)[0];
          }
        }
      },
      actual: () => mat.rectSubtract(src, rect),
      viaPTR() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            mat.PTR(rect.y + i, rect.x + j)[0] -= src.PTR(i, j)[0];
          }
        }
      },
    },
    {
      name: "replaceMatOnCol 64 行",
      n: 15000,
      reference() {
        const d = raw(mat);
        for (let i = 0; i < SIZE; i += 1) mat[d](i, 3)[0] = colArr[i];
      },
      actual: () => mat.replaceMatOnCol(colArr, 3),
      viaPTR() {
        for (let i = 0; i < SIZE; i += 1) mat.PTR(i, 3)[0] = colArr[i];
      },
    },
    {
      name: "addOnCol 64 行",
      n: 15000,
      reference() {
        const d = raw(mat);
        for (let i = 0; i < SIZE; i += 1) mat[d](i, 3)[0] += 1;
      },
      actual: () => mat.addOnCol(1, 3),
      viaPTR() {
        for (let i = 0; i < SIZE; i += 1) mat.PTR(i, 3)[0] += 1;
      },
    },
  ];

  let failed = false;

  for (const c of CASES) {
    const rounds = { reference: [], actual: [], viaPTR: [] };
    const keys = ["reference", "actual", "viaPTR"];
    for (let r = 0; r < ROUNDS; r += 1) {
      // 逐轮轮换起跑顺序，防止某一方系统性地总是先跑而吃到预热成本
      for (let k = 0; k < keys.length; k += 1) {
        const key = keys[(r + k) % keys.length];
        rounds[key].push(measure(c.n, c[key]));
      }
    }
    const best = (key) => Math.min(...rounds[key].slice(1));
    const reference = best("reference");
    const actual = best("actual");
    const viaPTR = best("viaPTR");
    const limit = reference * LIMIT_FACTOR;

    console.log(`\n${c.name}   (${c.n} 次 × ${ROUNDS} 轮，丢弃预热轮取最小值)`);
    console.log(
      `  参照（循环走原生访问器）  ${reference.toFixed(1).padStart(7)} ms   ← 基准`,
    );
    console.log(
      `  被测（dist/ 里的实现）    ${actual.toFixed(1).padStart(7)} ms   ${(actual / reference).toFixed(2)}x`,
    );
    console.log(
      `  退化参照（循环调 PTR）    ${viaPTR.toFixed(1).padStart(7)} ms   ${(viaPTR / reference).toFixed(2)}x   ← 本门禁要防的写法`,
    );
    console.log(`  阈值 ${limit.toFixed(1)} ms`);

    if (actual > limit) {
      console.error(
        `❌ 性能退化：${c.name} 比「循环走原生访问器」慢了 ` +
          `${(actual / reference).toFixed(2)}x —— 循环里是不是又逐像素调 PTR() 了？` +
          `（PTR 要读 rows/cols 两个 embind getter，那是两次跨语言调用）`,
      );
      failed = true;
    }
    if (viaPTR < reference * MIN_DISCRIMINATION) {
      console.error(
        `❌ 本门禁已失去鉴别力：${c.name} 上「循环调 PTR」只比参照慢 ` +
          `${(viaPTR / reference).toFixed(2)}x，而阈值是 ${LIMIT_FACTOR}x —— ` +
          `也就是说把循环改回 PTR 也能通过，门禁形同虚设。` +
          `请重新定标 LIMIT_FACTOR，或确认 embind getter 是否已变便宜（若是，` +
          `这个门禁连同 rawPtr 那套优化都该重新评估，而不是继续报绿）。`,
      );
      failed = true;
    }
  }

  mat.delete();
  src.delete();

  if (failed) {
    process.exit(1);
  }
  console.log("\n✅ 性能达标");
}

main().catch((e) => {
  console.error(`❌ 门禁未能执行: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
