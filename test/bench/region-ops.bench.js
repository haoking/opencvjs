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
// （曾实测 640×480 图配 100×100 ROI 可达 86x，而 8×8 全图 ROI 只有 1.6x）。
// 离开具体配置谈倍数没有意义，"7.1x" 这个数字也就无法被复现或证伪。所以下面
// 的 N/SIZE/RECT 就是那次测量本身，不是随手选的默认值——不要为了「测大图」
// 之类的目的改动它们；如需衡量别的尺寸，另开一个脚本。
//
// 本门禁比较的是「当前 roi() 实现」与「手写的原生 _roi + clone」这两者的耗时，
// 而不是重新对比旧的 cvtColor 实现（那份代码已被删除，无法再跑）。因为 roi()
// 内部现在就是原生 + clone，两者应当接近 1x；一旦未来又把 roi() 改回 cvtColor
// 往返一类的慢路径，这里的比值会明显跳升，门禁随之失败。
const { cv } = require("../helpers");

const N = 20000;
const SIZE = 64;
const RECT = new cv.Rect(1, 1, 32, 32);

function makeBig() {
  const data = new Array(SIZE * SIZE);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 7;
  return cv.matFromArray(SIZE, SIZE, cv.CV_32FC1, data);
}

function timed(label, fn) {
  const mat = makeBig();
  fn(mat); // 预热
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) fn(mat);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  mat.delete();
  console.log(`${label.padEnd(28)} ${ms.toFixed(0)} ms / ${N} 次`);
  return ms;
}

const baseline = timed("原生 _roi + clone (基准)", (m) => {
  const v = m._roi(RECT);
  const d = v.clone();
  v.delete();
  d.delete();
});

const actual = timed("roi() 当前实现", (m) => {
  const d = m.roi(RECT);
  d.delete();
});

// 当前实现就是「原生 + clone」，允许 50% 的测量噪声余量。
const LIMIT = baseline * 1.5;
console.log(`\n阈值: ${LIMIT.toFixed(0)} ms   实测: ${actual.toFixed(0)} ms`);

if (actual > LIMIT) {
  console.error(
    `❌ 性能退化：roi() 比「原生 + clone」慢了 ${(actual / baseline).toFixed(1)}x`,
  );
  process.exit(1);
}
console.log("✅ 性能达标");
