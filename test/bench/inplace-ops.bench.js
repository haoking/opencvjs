"use strict";

// 就地写入类操作的性能回归门禁。
//
// ── 这个门禁防的是什么 ────────────────────────────────────────────────────────
// replaceMatOnRect / rectAdd / rectSubtract / replaceMatOnCol / addOnCol 这五个方法是
// 逐像素写入的。它们在入口用 guards 一次性证明下标范围合法，循环里按地址直接读写
// wasm 堆（typed-access 的 pixels()），**一次 embind 调用都不做**。
//
// 最容易被写回去的是「逐像素调访问器」：原生的 *Ptr(i, j)（3.0.0 就是这么写的），
// 或者更短的 PTR(i, j)。代码更短、行为也正确，只是每个像素都要跨一次语言边界、再新建
// 一个 TypedArray（PTR 还要多读 rows / cols 两个 embind getter）——慢上百倍。本文件
// 每次运行都把这两种写法作为「退化参照」一起测、把倍数打印出来。**别把倍数抄进别处的
// 注释**：源码里曾经同时存在 38% / 82% / 105% 三种说法（三组口径不同的对照），互相
// 差到一倍；要引用就引用本门禁的输出。
//
// ── 为什么 region-ops.bench.js 覆盖不到 ──────────────────────────────────────
// 那个门禁测的是 roiClone()，而 roiClone() 内部是「原生 roi + clone」，**根本不逐像素
// 循环**。把上面这几个方法的循环改回逐像素调访问器，它照样一路绿灯——在本文件出现
// 之前，这样一次退化能悄悄合进主干。这正是本项目一直在清的「会说谎的绿灯」。
//
// ── 门禁的形状（与直觉相反的一点）────────────────────────────────────────────
// 直觉的写法是「对照组 = 退化写法，阈值 1.5×」。**那是无效的**，方向反了：被测实现比
// 退化写法快得多，比值远小于 1；真有人把循环改回退化写法，比值也只升到 1.0 左右，
// 离 1.5 的阈值还远——门禁照样打印「达标」。所以基准取的是**「按地址直接读写堆」的
// 手写参照**，也就是被测实现该有的样子（和 region-ops.bench.js 拿被测实现所封装的原语
// 当基准同理），阈值为参照 × 1.5。这个形状对「循环变慢」这件事本身报警，不只针对某一
// 种写法。退化参照照样每轮都测，同时用来检查本门禁**还有没有鉴别力**，见
// MIN_DISCRIMINATION 那段。
//
// ── 次数、规模与比较口径 ──────────────────────────────────────────────────────
// 快慢两类实现差两个数量级：用同一个次数，要么快的那一方只跑几毫秒、测不准，要么
// 慢的那一方一轮就要几秒。所以各用各的次数，比较的是**每次调用**的耗时。
//
// 规模刻意取大（512×512 上写 256×256、列长 512）。被测实现每次调用有一笔与像素数
// 无关的固定开销：入口校验要读 rows / cols 等 embind getter，取地址也要读 data /
// step。在 32×32 上循环本身只要约 1 µs，那笔固定开销就占到三四成，比值贴着 1.5
// 的阈值来回晃（实测 1.46–1.48x），门禁会随机报红。本门禁防的是**每像素**的开销
// 退化，规模一大，固定开销的占比可以忽略，退化照样一眼可见。
//
// 测量方法与 region-ops.bench.js 一致：各实现逐轮轮换起跑顺序、丢弃第 1 轮（JIT 分层
// 编译与 embind 调用桥的一次性预热会被先跑的那一方整体付掉，是测量顺序造成的伪影）、
// 取第 2 轮起的最小值。
const { getCv } = require("../helpers");

const SIZE = 512; // 源图 512×512 CV_32FC1
const RECT = { x: 1, y: 1, width: 256, height: 256 };
const COL = 3;
const ROUNDS = 4; // 第 1 轮是预热轮，丢弃；取第 2..4 轮的最小值

// 被测实现相对参照允许的倍数。多出来的只该是入口校验与取堆视图的固定开销，
// 留 50% 给测量噪声（region-ops.bench.js 用的也是 1.5，理由相同）。
const LIMIT_FACTOR = 1.5;

// 每个退化参照至少要比参照慢这么多，本门禁才有鉴别力可言：如果退化写法只慢 20%，
// 那么把循环改回那种写法也过得了 1.5 倍的门禁。真跌到这里以下就要发声，而不是继续
// 报绿——那意味着 embind 调用变便宜了（门禁该重新定标），或者被测实现已经在偷偷做
// 等价的事。
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

/** 跑 n 次，返回每次调用的平均耗时（微秒）。 */
function perCallMicros(n, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) fn();
  return Number(process.hrtime.bigint() - start) / 1e3 / n;
}

async function main() {
  const cv = await getCv();

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

  /**
   * 参照实现用的寻址：每次调用都重新取（被测实现也是每次调用都取），CV_32F 专用。
   * 堆视图最后取，理由同 typed-access.js 的 pixels()。
   */
  function layout(m) {
    const base = m.data.byteOffset / 4;
    const rowStep = m.step[0] / 4;
    const pixelStep = m.elemSize() / 4;
    return { heap: cv.HEAPF32, base, rowStep, pixelStep };
  }

  // 每个用例四份实现：
  //   reference —— 参照：按地址直接读写堆（= 被测实现该有的样子），作为基准
  //   actual    —— 被测：dist/ 里真正发布的那个方法
  //   nativePtr —— 退化参照：循环里逐像素调原生 floatPtr()（3.0.0 的写法）
  //   viaPTR    —— 退化参照：循环里逐像素调 PTR()
  // fast / slow 是两类实现各自的调用次数。
  // 参照与退化参照都不收「(旧值, 新值) => 值」这种回调：三个用例共用同一段函数
  // 字面量，回调的调用点会变成多态、V8 不再内联，参照自己就先慢了一截，门禁随之
  // 变松。被测实现也是出于同一个原因拆成固定形状的内核（见 mat-region.js）。
  // sign：0 = 拷贝，1 = 累加，-1 = 相减。
  const CASES = [];
  for (const [name, sign] of [
    ["replaceMatOnRect", 0],
    ["rectAdd", 1],
    ["rectSubtract", -1],
  ]) {
    CASES.push({
      name: `${name} ${RECT.width}×${RECT.height}`,
      fast: 1000,
      slow: 10,
      reference() {
        const d = layout(mat);
        const s = layout(src);
        const { x, y, width: w, height: h } = rect;
        for (let i = 0; i < h; i += 1) {
          let di = d.base + (y + i) * d.rowStep + x * d.pixelStep;
          let si = s.base + i * s.rowStep;
          if (sign === 0) {
            for (
              let j = 0;
              j < w;
              j += 1, di += d.pixelStep, si += s.pixelStep
            ) {
              d.heap[di] = s.heap[si];
            }
          } else {
            for (
              let j = 0;
              j < w;
              j += 1, di += d.pixelStep, si += s.pixelStep
            ) {
              d.heap[di] += sign * s.heap[si];
            }
          }
        }
      },
      actual: () => mat[name](src, rect),
      nativePtr() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            const px = mat.floatPtr(i + rect.y, j + rect.x);
            const v = src.floatPtr(i, j)[0];
            px[0] = sign === 0 ? v : px[0] + sign * v;
          }
        }
      },
      viaPTR() {
        for (let i = 0; i < rect.height; i += 1) {
          for (let j = 0; j < rect.width; j += 1) {
            const px = mat.PTR(i + rect.y, j + rect.x);
            const v = src.PTR(i, j)[0];
            px[0] = sign === 0 ? v : px[0] + sign * v;
          }
        }
      },
    });
  }
  for (const [name, replace] of [
    ["replaceMatOnCol", true],
    ["addOnCol", false],
  ]) {
    CASES.push({
      name: `${name} ${SIZE} 行`,
      fast: 100000,
      slow: 2000,
      reference() {
        const rows = mat.rows;
        const d = layout(mat);
        let k = d.base + COL * d.pixelStep;
        if (replace) {
          for (let i = 0; i < rows; i += 1, k += d.rowStep)
            d.heap[k] = colArr[i];
        } else {
          for (let i = 0; i < rows; i += 1, k += d.rowStep) d.heap[k] += 1;
        }
      },
      actual: replace
        ? () => mat.replaceMatOnCol(colArr, COL)
        : () => mat.addOnCol(1, COL),
      nativePtr() {
        for (let i = 0; i < SIZE; i += 1) {
          const px = mat.floatPtr(i, COL);
          px[0] = replace ? colArr[i] : px[0] + 1;
        }
      },
      viaPTR() {
        for (let i = 0; i < SIZE; i += 1) {
          const px = mat.PTR(i, COL);
          px[0] = replace ? colArr[i] : px[0] + 1;
        }
      },
    });
  }

  const IMPLS = [
    ["reference", "fast"],
    ["actual", "fast"],
    ["nativePtr", "slow"],
    ["viaPTR", "slow"],
  ];

  let failed = false;

  for (const c of CASES) {
    const rounds = Object.fromEntries(IMPLS.map(([key]) => [key, []]));
    for (let r = 0; r < ROUNDS; r += 1) {
      // 逐轮轮换起跑顺序，防止某一方系统性地总是先跑而吃到预热成本
      for (let k = 0; k < IMPLS.length; k += 1) {
        const [key, count] = IMPLS[(r + k) % IMPLS.length];
        rounds[key].push(perCallMicros(c[count], c[key]));
      }
    }
    const best = (key) => Math.min(...rounds[key].slice(1));
    const reference = best("reference");
    const actual = best("actual");
    const nativePtr = best("nativePtr");
    const viaPTR = best("viaPTR");
    const limit = reference * LIMIT_FACTOR;
    const us = (v) => `${v.toFixed(2).padStart(8)} µs`;
    const ratio = (v) => `${(v / reference).toFixed(2)}x`;

    console.log(
      `\n${c.name}   （每次调用的耗时；快 ${c.fast} 次 / 慢 ${c.slow} 次 × ${ROUNDS} 轮，丢弃预热轮取最小值）`,
    );
    console.log(
      `  参照（按地址直接读写堆）          ${us(reference)}   ← 基准`,
    );
    console.log(
      `  被测（dist/ 里的实现）            ${us(actual)}   ${ratio(actual)}`,
    );
    console.log(
      `  退化参照（循环调原生 floatPtr）   ${us(nativePtr)}   ${ratio(nativePtr)}   ← 3.0.0 的写法`,
    );
    console.log(
      `  退化参照（循环调 PTR）            ${us(viaPTR)}   ${ratio(viaPTR)}   ← 本门禁要防的写法`,
    );
    console.log(`  阈值 ${limit.toFixed(2)} µs`);

    if (actual > limit) {
      console.error(
        `❌ 性能退化：${c.name} 比「按地址直接读写堆」慢了 ${ratio(actual)} —— ` +
          `循环里是不是又逐像素调访问器了？（每像素一次跨语言调用、一个新 TypedArray）`,
      );
      failed = true;
    }
    for (const [label, value] of [
      ["循环调原生 floatPtr", nativePtr],
      ["循环调 PTR", viaPTR],
    ]) {
      if (value < reference * MIN_DISCRIMINATION) {
        console.error(
          `❌ 本门禁已失去鉴别力：${c.name} 上「${label}」只比参照慢 ${ratio(value)}，` +
            `而阈值是 ${LIMIT_FACTOR}x —— 把循环改回那种写法也能通过，门禁形同虚设。` +
            `请重新定标 LIMIT_FACTOR，或确认 embind 调用是否已变便宜（若是，这个门禁` +
            `连同按地址读写堆的那套写法都该重新评估，而不是继续报绿）。`,
        );
        failed = true;
      }
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
