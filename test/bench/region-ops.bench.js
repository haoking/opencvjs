"use strict";

// 区域操作性能回归门禁。
//
// 背景：修复前，roi()/col()/Diag() 用 cvtColor(GRAY2BGR) → 操作 → cvtColor(BGR2GRAY)
// 往返来制造连续副本，比「原生 _roi()/_col()/diag() + clone()」慢数倍，且只支持
// 8U/16U/32F 深度。现已改为后者（见 opencv.js 中 cloneAndRelease 上方注释）。
// 该注释里「实测 roi 7.1x」这个数字，测的就是本文件固定的这套配置——不多不少：
//
//   图像:  64×64  CV_32FC1
//   区域:  Rect(1, 1, 32, 32)         （32×32，非全图、不贴边）
//   迭代:  20000 次
//   结果:  旧实现(cvtColor 往返) 220ms  vs  原生 _roi + clone 31ms  ≈ 7.1x
//
// 之所以要把这套配置钉死在这里：不同图像/区域尺寸下，两种实现的倍数差异极大
// （640×480 图配 100×100 ROI 可达 86x，而 8×8 全图 ROI 只有 1.6x——这两个数字
// 来自本项目 Task 3 的评审实测记录，不是外部引用）。离开具体配置谈倍数没有
// 意义，"7.1x" 这个数字也就无法被复现或证伪。所以下面的 N/SIZE/RECT 就是那次
// 测量本身，不是随手选的默认值——不要为了「测大图」之类的目的改动它们；如需
// 衡量别的尺寸，另开一个脚本。
//
// 测量方法——为什么要丢弃第 1 轮：
// 本门禁比较的是「当前 roi() 实现」与「手写的原生 _roi + clone」这两者的耗时，
// 而不是重新对比旧的 cvtColor 实现（那份代码已被删除，无法再跑）。因为 roi()
// 内部现在就是原生 + clone，两者做的事完全一样，比值理应接近 1x。
// 但首轮测量同时包含 JIT 分层编译与 embind 调用桥的一次性预热成本，这笔成本
// 会被「先执行的那一方」整体付掉，导致谁先跑谁在首轮就显得更慢——这是测量
// 顺序造成的伪影，不是两种实现的真实差异（曾用 5 组实验钉死这个结论：交换
// 执行顺序后结果完全镜像反转——谁先跑谁慢；各自放进独立进程测，两者几乎
// 完全相等；同进程内交替跑多轮，第 2 轮起两者才收敛到接近的数值，且不再受
// 顺序影响）。因此下面跑 ROUNDS 轮，baseline/actual 的先后顺序逐轮交替，丢弃
// 第 1 轮（预热轮），取第 2 轮起的最小值作为各自最终耗时——这样比值才反映
// 真实差异，而不是谁先跑谁吃亏。一旦未来真把 roi() 改回 cvtColor 往返一类的
// 慢路径，这里的比值会明显跳升，门禁随之失败。
const { cv } = require("../helpers");

const N = 20000;
const SIZE = 64;
const RECT = new cv.Rect(1, 1, 32, 32);
const ROUNDS = 4; // 第 1 轮是预热轮，丢弃；取第 2..4 轮的最小值

function makeBig() {
  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  return cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
}

function baselineOp(m) {
  const v = m._roi(RECT);
  const d = v.clone();
  v.delete();
  d.delete();
}

function actualOp(m) {
  const d = m.roi(RECT);
  d.delete();
}

function measure(mat, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) fn(mat);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const mat = makeBig();
const baselineRounds = [];
const actualRounds = [];

for (let r = 0; r < ROUNDS; r += 1) {
  // 逐轮交替先后顺序，防止某一方系统性地总是先跑/后跑而吃到预热成本。
  if (r % 2 === 0) {
    baselineRounds.push(measure(mat, baselineOp));
    actualRounds.push(measure(mat, actualOp));
  } else {
    actualRounds.push(measure(mat, actualOp));
    baselineRounds.push(measure(mat, baselineOp));
  }
  const tag = r === 0 ? "（预热轮，丢弃）" : "";
  console.log(
    `round ${r + 1}: baseline ${baselineRounds[r].toFixed(1).padStart(6)} ms` +
      `   actual ${actualRounds[r].toFixed(1).padStart(6)} ms  ${tag}`,
  );
}
mat.delete();

// 丢弃第 1 轮，取后续轮次的最小值作为各自最终耗时。
const baseline = Math.min(...baselineRounds.slice(1));
const actual = Math.min(...actualRounds.slice(1));

console.log(
  `\n原生 _roi + clone (基准)     ${baseline.toFixed(1)} ms / ${N} 次`,
);
console.log(`roi() 当前实现               ${actual.toFixed(1)} ms / ${N} 次`);

// 当前实现就是「原生 + clone」，两者应当接近 1x；允许 50% 的测量噪声余量。
const LIMIT = baseline * 1.5;
console.log(`\n阈值: ${LIMIT.toFixed(1)} ms   实测: ${actual.toFixed(1)} ms`);

if (actual > LIMIT) {
  console.error(
    `❌ 性能退化：roi() 比「原生 + clone」慢了 ${(actual / baseline).toFixed(1)}x`,
  );
  process.exit(1);
}
console.log("✅ 性能达标");
