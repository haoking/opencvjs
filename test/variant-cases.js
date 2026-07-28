"use strict";

// baseline / simd 两个变体的数值对比用例表，以及跑这张表的**子进程执行器**。
//
//   node test/variant-cases.js <baseline|simd> <输出 JSON 路径>
//
// 由 test/unit/variant-parity.test.js 调用。放在 test/ 顶层是为了不被
// `npm test` 的 glob（test/*/*.test.js）当成测试文件捡走。
//
// ── 为什么必须是子进程 ────────────────────────────────────────────────────
// 两个变体**不能在同一个进程里同时加载**。OpenCV 的 UMD 外壳最后一段是
//
//     if (typeof Module === 'undefined')
//       Module = {};
//     return cv(Module);
//
// 这里的 `Module = {}` 没有 var/let/const，而整个 UMD 外壳不是严格模式
// （文件里一个 "use strict" 都没有），于是它是一个**隐式全局变量**。
// 后果：第一个变体加载后 globalThis.Module 就指向它的 cv 对象（已实测
// `global.Module === cv` 为 true）；第二个变体再 require 进来时
// `typeof Module === 'undefined'` 为假，于是把**同一个对象**喂给自己的工厂，
// embind 在往上注册符号时撞车，抛
//     BindingError: Cannot register public name 'IntVector' twice
//
// 已实测：在两次 require 之间 `delete global.Module` 就能绕开，两个实例随后
// 各自工作正常。但本文件不走那条路——那是在依赖上游一个 sloppy-mode 疏漏的
// 具体表现形式。每个变体一个干净进程，既不依赖这个细节，也顺带排除了其他
// 尚未发现的跨实例状态共享。
//
// ⚠️ 同一条约束对使用者也成立：一个进程里只能加载一个变体。正常用法不受影响
// （loadOpenCV() 只加载一个），但想在同一进程里对比两个变体是不行的。
const fs = require("fs");
const path = require("path");

/**
 * 确定性伪随机源。两个变体必须拿到逐字节相同的输入，否则比较毫无意义——
 * 所以不能用 Math.random()。这是个 32 位 LCG（乘数取自 Numerical Recipes），
 * 只要求可复现，不要求统计性质。
 */
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
  // 值域刻意跨越 0 并带小数：全是小整数的话，浮点内核算错了也看不出来。
  for (let i = 0; i < n; i += 1) out[i] = (rnd() % 20000) / 100 - 100;
  return out;
}

/** 按 depth 取对应的 TypedArray 视图并拷成普通数组。 */
function dump(cv, mat) {
  switch (mat.depth()) {
    case cv.CV_8U:
      return Array.from(mat.data);
    case cv.CV_8S:
      return Array.from(mat.data8S);
    case cv.CV_16U:
      return Array.from(mat.data16U);
    case cv.CV_16S:
      return Array.from(mat.data16S);
    case cv.CV_32S:
      return Array.from(mat.data32S);
    case cv.CV_32F:
      return Array.from(mat.data32F);
    case cv.CV_64F:
      return Array.from(mat.data64F);
    default:
      throw new Error(`未预期的 depth: ${mat.depth()}`);
  }
}

// ---------------------------------------------------------------------------
// 用例表。run(cv) 返回一个数字数组。
//
// exact = true  要求两个变体**逐位相同**：整数内核不存在舍入差异，本项目扩展层
//               那几个方法更是纯拷贝/整数循环，任何差异都是 bug。
// exact = false 只要求相对误差 <= 容差：浮点 SIMD 内核会改变累加与乘加的结合
//               顺序（可分离滤波、点积、变换），末位差异是规范允许的。
//
// 选点覆盖三类：① 上游 2020 年那组逐 kernel 数据里 SIMD 影响最大的几个
// （resize 8UC4 1.77x / pyrDown 32FC4 3.09x / gaussianBlur 3.36x，以及**反例**
// blur CV_32FC1 0.519x）；② 本项目自己的扩展层；③ 几个最常用的逐元素与几何
// 变换内核。规模刻意压小——这张表比的是**数值**，不是速度，速度归
// test/simd-compare.js 管。
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: "add 8UC1（逐元素整数）",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 1));
      const b = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 2));
      const d = new cv.Mat();
      cv.add(a, b, d);
      const out = dump(cv, d);
      a.delete();
      b.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "absdiff 8UC3（逐元素整数、多通道）",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_8UC3, bytes(3072, 3));
      const b = cv.matFromArray(32, 32, cv.CV_8UC3, bytes(3072, 4));
      const d = new cv.Mat();
      cv.absdiff(a, b, d);
      const out = dump(cv, d);
      a.delete();
      b.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "threshold 8UC1",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 5));
      const d = new cv.Mat();
      cv.threshold(a, d, 128, 255, cv.THRESH_BINARY);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "cvtColor RGBA2GRAY（整数定点）",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(48, 48, cv.CV_8UC4, bytes(48 * 48 * 4, 6));
      const d = new cv.Mat();
      cv.cvtColor(a, d, cv.COLOR_RGBA2GRAY);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "resize 8UC4 INTER_LINEAR（上游实测 1.77x 的那一项）",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC4, bytes(64 * 64 * 4, 7));
      const d = new cv.Mat();
      cv.resize(a, d, new cv.Size(37, 41), 0, 0, cv.INTER_LINEAR);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "resize 32FC1 INTER_LINEAR",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 8));
      const d = new cv.Mat();
      cv.resize(a, d, new cv.Size(37, 41), 0, 0, cv.INTER_LINEAR);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "GaussianBlur 8UC1（上游实测 3.36x 的那一项）",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 9));
      const d = new cv.Mat();
      cv.GaussianBlur(a, d, new cv.Size(5, 5), 1.4, 1.4, cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "blur 32FC1（上游实测 0.519x —— SIMD 反而更慢的那一项）",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 10));
      const d = new cv.Mat();
      cv.blur(a, d, new cv.Size(5, 5), new cv.Point(-1, -1), cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "pyrDown 32FC4（上游实测 3.09x 的那一项）",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC4, floats(64 * 64 * 4, 11));
      const d = new cv.Mat();
      cv.pyrDown(a, d, new cv.Size(0, 0), cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "Sobel 32FC1",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 12));
      const d = new cv.Mat();
      cv.Sobel(a, d, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "warpAffine 8UC1",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(64, 64, cv.CV_8UC1, bytes(4096, 13));
      // 固定的仿射矩阵：轻微旋转 + 平移，避免退化成纯拷贝。
      const m = cv.matFromArray(
        2,
        3,
        cv.CV_64FC1,
        [0.94, -0.34, 3.5, 0.34, 0.94, -2.5],
      );
      const d = new cv.Mat();
      cv.warpAffine(a, d, m, new cv.Size(64, 64));
      const out = dump(cv, d);
      a.delete();
      m.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "dft 32FC1（浮点累加，最容易因指令顺序而差末位）",
    exact: false,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_32FC1, floats(1024, 14));
      const d = new cv.Mat();
      cv.dft(a, d, cv.DFT_COMPLEX_OUTPUT, 0);
      const out = dump(cv, d);
      a.delete();
      d.delete();
      return out;
    },
  },
  {
    name: "扩展层 roiClone / colClone / diagClone",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(32, 32, cv.CV_32FC3, floats(32 * 32 * 3, 15));
      const r = a.roiClone(new cv.Rect(3, 5, 11, 13));
      const c = a.colClone(7);
      const g = a.diagClone();
      const out = [...dump(cv, r), ...dump(cv, c), ...dump(cv, g)];
      a.delete();
      r.delete();
      c.delete();
      g.delete();
      return out;
    },
  },
  {
    name: "扩展层 rectAdd / addOnCol / reshapeRows / norm2",
    exact: true,
    run(cv) {
      const a = cv.matFromArray(16, 16, cv.CV_32SC1, bytes(256, 16));
      const patch = cv.matFromArray(4, 4, cv.CV_32SC1, bytes(16, 17));
      // 签名是 rectAdd(src, rect) / replaceMatOnRect(src, rect)：源在前、矩形在后。
      a.rectAdd(patch, new cv.Rect(2, 3, 4, 4));
      // replaceMatOnCol(arr, col) 的第一个参数是**数组**，不是 Mat。
      a.replaceMatOnCol(bytes(16, 18), 5);
      // addOnCol 的第一个参数是**标量常数**，不是 Mat。
      a.addOnCol(7, 9);
      const re = a.reshapeRows(8);
      const b = cv.matFromArray(16, 16, cv.CV_32SC1, bytes(256, 19));
      const n = cv.norm2(a, b);
      const out = [...dump(cv, a), ...dump(cv, re), n];
      a.delete();
      patch.delete();
      re.delete();
      b.delete();
      return out;
    },
  },
];

module.exports = { CASES, lcg, bytes, floats, dump };

// --- 子进程执行器 -----------------------------------------------------------
if (require.main === module) {
  const variant = process.argv[2];
  const outFile = process.argv[3];
  if (variant !== "baseline" && variant !== "simd") {
    console.error(
      `用法: node test/variant-cases.js <baseline|simd> <输出 JSON 路径>`,
    );
    process.exit(2);
  }
  if (!outFile) {
    // 走文件而不是 stdout：这张表一趟能吐出四万多个数，JSON 文本几百 KB，
    // execFileSync 默认 maxBuffer 只有 1 MB，靠近上限的失败方式很难看懂。
    console.error("缺少输出 JSON 路径");
    process.exit(2);
  }
  const dist = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");
  // 显式点名变体。缺失时 dist/index.js 会抛错而不是回落到另一个——正是这条
  // 保证了「simd 那一侧真的是 simd」，否则整个对比会拿 baseline 跟自己比，恒过。
  require(path.join(dist, "index.js"))({ simd: variant === "simd" })
    .then((cv) => {
      const out = {};
      for (const c of CASES) out[c.name] = c.run(cv);
      fs.writeFileSync(outFile, JSON.stringify(out));
    })
    .catch((e) => {
      console.error(`❌ ${variant} 变体执行失败: ${(e && e.message) || e}`);
      process.exit(1);
    });
}
