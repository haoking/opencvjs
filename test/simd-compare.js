"use strict";

// baseline vs simd 的**实测**性能对比。用法: npm run simd:compare
//
// ⚠️ 这不是门禁，永远不会因为某个操作变慢而退出非零。理由：SIMD 不是无脑赢。
// 上游 2020 年那组逐 kernel 数据里就有明确的反例——blur CV_32FC1 只有 0.519x，
// 也就是 SIMD 版本比标量慢了近一倍。把「SIMD 必须更快」写成门禁，等于逼着以后
// 的人要么删门禁、要么只挑有利的算子来测。本脚本只负责把真实数字打出来，包括
// 难看的那些。
//
// 这也不是 test/bench/*.bench.js：那两个是回归门禁（有阈值、会 exit 1），
// 而且 npm run bench 会把这个目录下的每个文件都当门禁跑。本文件放在 test/ 顶层，
// 既不被 `npm test`（glob 是 test/*/*.test.js）也不被 `npm run bench` 捡到。
//
// 需要 dist/ 下同时有 baseline 与 simd 两个变体；缺 simd 时直接说明并退出 0。
//
// ── 为什么每个变体一个子进程 ──────────────────────────────────────────────
// 两个变体不能在同一个进程里同时加载 —— OpenCV 的 UMD 外壳把 Module 泄漏成了
// 隐式全局变量，第二个变体会撞上第一个的 embind 注册表（机理与实测结论写在
// test/variant-cases.js 顶部）。
//
// 这对**测速**其实是好事，不只是绕开限制：test/bench/region-ops.bench.js 那段
// 关于预热的说明里记着一条实测结论——「各自放进独立进程测，两者几乎完全相等」，
// 也就是独立进程本身就是无偏的对照方式。所以这里的做法是：每个变体在自己的
// 进程里跑 ROUNDS 轮、丢弃第 1 轮（JIT 分层编译与 embind 调用桥的一次性预热）、
// 取最小值；父进程再把两个变体的启动顺序前后各跑一遍（[base, simd] 与
// [simd, base]），取各自两趟的最小值——这样连「谁先启动」带来的机器状态差异
// （页缓存、CPU 频率爬坡）也被抵掉。
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const path = require("path");

const DIST = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");
const ROUNDS = 4; // 第 1 轮预热，丢弃

/** 确定性输入。两个变体必须拿到同样的数据，否则比的是不同的工作量。 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}
function bytes(n, seed) {
  const rnd = lcg(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rnd() % 256;
  return out;
}
function floats(n, seed) {
  const rnd = lcg(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (rnd() % 20000) / 100 - 100;
  return out;
}

// ---------------------------------------------------------------------------
// 用例。setup(cv) 建一次输入，op(cv, ctx) 跑一次操作，teardown 收尸。
//
// 选点：① 上游 2020 年逐 kernel 数据里差异最大的四项（resize 8UC4 1.77x /
// pyrDown 32FC4 3.09x / gaussianBlur 3.36x / blur 32FC1 0.519x —— 最后一项是
// 反例，必须留着）；② 本项目扩展层实际会落到的原生原语（roi+clone、
// 逐像素写入）；③ 几个常用的逐元素与颜色转换算子。
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: "add 8UC1 256x256",
    iters: 400,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 1)),
      b: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 2)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.add(c.a, c.b, c.d),
  },
  {
    name: "absdiff 8UC3 256x256",
    iters: 300,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC3, bytes(196608, 3)),
      b: cv.matFromArray(256, 256, cv.CV_8UC3, bytes(196608, 4)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.absdiff(c.a, c.b, c.d),
  },
  {
    name: "cvtColor RGBA2GRAY 8UC4 256x256",
    iters: 300,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC4, bytes(262144, 5)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.cvtColor(c.a, c.d, cv.COLOR_RGBA2GRAY),
  },
  {
    name: "resize 8UC4 256x256 -> 128x128（上游 1.77x）",
    iters: 200,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC4, bytes(262144, 6)),
      d: new cv.Mat(),
      size: new cv.Size(128, 128),
    }),
    op: (cv, c) => cv.resize(c.a, c.d, c.size, 0, 0, cv.INTER_LINEAR),
  },
  {
    name: "GaussianBlur 8UC1 256x256 k=5（上游 3.36x）",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 7)),
      d: new cv.Mat(),
      k: new cv.Size(5, 5),
    }),
    op: (cv, c) => cv.GaussianBlur(c.a, c.d, c.k, 1.4, 1.4, cv.BORDER_DEFAULT),
  },
  {
    name: "blur 32FC1 256x256 k=5（上游 0.519x —— 反例）",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 8)),
      d: new cv.Mat(),
      k: new cv.Size(5, 5),
      anchor: new cv.Point(-1, -1),
    }),
    op: (cv, c) => cv.blur(c.a, c.d, c.k, c.anchor, cv.BORDER_DEFAULT),
  },
  {
    name: "pyrDown 32FC4 256x256（上游 3.09x）",
    iters: 100,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC4, floats(262144, 9)),
      d: new cv.Mat(),
      z: new cv.Size(0, 0),
    }),
    op: (cv, c) => cv.pyrDown(c.a, c.d, c.z, cv.BORDER_DEFAULT),
  },
  {
    name: "Sobel 32FC1 256x256",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 10)),
      d: new cv.Mat(),
    }),
    op: (cv, c) =>
      cv.Sobel(c.a, c.d, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT),
  },
  {
    name: "dft 32FC1 256x256",
    iters: 60,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 11)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.dft(c.a, c.d, cv.DFT_COMPLEX_OUTPUT, 0),
  },
  {
    name: "warpAffine 8UC1 256x256",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 12)),
      m: cv.matFromArray(
        2,
        3,
        cv.CV_64FC1,
        [0.94, -0.34, 3.5, 0.34, 0.94, -2.5],
      ),
      d: new cv.Mat(),
      size: new cv.Size(256, 256),
    }),
    op: (cv, c) => cv.warpAffine(c.a, c.d, c.m, c.size),
  },
  {
    name: "扩展层 roiClone 64x64 取 32x32",
    iters: 20000,
    setup: (cv) => ({
      a: cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 13)),
      r: new cv.Rect(1, 1, 32, 32),
    }),
    op: (cv, c) => {
      const d = c.a.roiClone(c.r);
      d.delete();
    },
  },
  {
    name: "扩展层 replaceMatOnRect 64x64 写 32x32",
    iters: 2000,
    setup: (cv) => ({
      a: cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 14)),
      p: cv.matFromArray(32, 32, cv.CV_32FC1, floats(1024, 15)),
      r: new cv.Rect(1, 1, 32, 32),
    }),
    // 签名是 replaceMatOnRect(src, rect)：源在前、矩形在后。
    op: (cv, c) => c.a.replaceMatOnRect(c.p, c.r),
  },
];

function measure(cv, c, ctx) {
  const t0 = performance.now();
  for (let i = 0; i < c.iters; i += 1) c.op(cv, ctx);
  return performance.now() - t0;
}

function release(ctx) {
  for (const v of Object.values(ctx)) {
    if (v && typeof v.delete === "function") v.delete();
  }
}

// --- 子进程：只测一个变体，把每个用例的最小耗时写成 JSON --------------------
async function child(variant, outFile) {
  const cv = await require(path.join(DIST, "index.js"))({
    simd: variant === "simd",
  });
  const result = {};
  for (const c of CASES) {
    const ctx = c.setup(cv);
    const rounds = [];
    for (let r = 0; r < ROUNDS; r += 1) rounds.push(measure(cv, c, ctx));
    release(ctx);
    // 丢弃第 1 轮（预热），取其余最小值。ROUNDS 是常量 4，slice(1) 不会为空；
    // 若将来有人把它改成 1，Math.min() 会返回 Infinity —— 这里直接拦住。
    const kept = rounds.slice(1);
    if (kept.length === 0) {
      throw new Error(`ROUNDS 必须 >= 2（当前 ${ROUNDS}）：第 1 轮是预热轮`);
    }
    result[c.name] = Math.min(...kept);
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

// --- 父进程：交替启动顺序各跑一趟，取每个变体两趟的最小值 --------------------
function runChild(variant, tmp, tag) {
  const f = path.join(tmp, `${variant}-${tag}.json`);
  execFileSync(process.execPath, [__filename, variant, f], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, OPENCV_DIST: DIST },
  });
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function parent() {
  const simdGlue = path.join(DIST, "simd", "opencv.js");
  if (!fs.existsSync(simdGlue)) {
    console.log(`⚠️  ${simdGlue} 不存在 —— 没有 SIMD 变体可比。`);
    console.log(
      "    先 build/build.sh --simd（需要 Docker），再 npm run assemble <baseline> <simd>。",
    );
    return;
  }

  console.log(`node ${process.version} / ${process.platform}-${process.arch}`);
  console.log(
    `每个变体一个子进程，ROUNDS=${ROUNDS}（丢首轮取最小），启动顺序前后各一趟\n`,
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencvjs-simdcmp-"));
  let a1, s1, s2, a2;
  try {
    a1 = runChild("baseline", tmp, "p1");
    s1 = runChild("simd", tmp, "p1");
    s2 = runChild("simd", tmp, "p2");
    a2 = runChild("baseline", tmp, "p2");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(
    "操作".padEnd(46) +
      "baseline".padStart(11) +
      "simd".padStart(11) +
      "加速比".padStart(10),
  );
  console.log("-".repeat(78));

  const rows = [];
  for (const c of CASES) {
    const b = Math.min(a1[c.name], a2[c.name]);
    const s = Math.min(s1[c.name], s2[c.name]);
    const ratio = b / s; // > 1 表示 SIMD 更快
    rows.push({ name: c.name, b, s, ratio });
    console.log(
      c.name.padEnd(46) +
        `${b.toFixed(1)} ms`.padStart(11) +
        `${s.toFixed(1)} ms`.padStart(11) +
        `${ratio.toFixed(2)}x`.padStart(10),
    );
  }

  const slower = rows.filter((r) => r.ratio < 1);
  console.log("-".repeat(78));
  console.log(
    `共 ${rows.length} 项，SIMD 更快 ${rows.length - slower.length} 项，更慢 ${slower.length} 项。`,
  );
  if (slower.length) {
    console.log("更慢的项（这不是 bug，是必须记录的事实）:");
    for (const r of slower) {
      console.log(`  ${r.name}  ${r.ratio.toFixed(2)}x`);
    }
  }
  // 刻意不 exit(1)：见文件头。
}

async function main() {
  const variant = process.argv[2];
  if (variant === "baseline" || variant === "simd") {
    const outFile = process.argv[3];
    if (!outFile) throw new Error("子进程模式缺少输出 JSON 路径");
    await child(variant, outFile);
    return;
  }
  if (variant !== undefined) {
    throw new Error(
      `未知参数 ${variant}（本脚本无需参数；子进程模式由自己调用）`,
    );
  }
  parent();
}

main().catch((e) => {
  console.error(`❌ 对比未能执行: ${(e && e.message) || e}`);
  process.exit(1);
});
