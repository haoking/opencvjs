"use strict";

// 非连续 Mat（原生 roi() / col() 返回的视图）上的扩展方法。
//
// 2.0 起原生 roi() / col() / diag() 不再被覆盖，文档也明确把它们当作「写回源 Mat」
// 的正当途径（见 README 的 roiClone() 一节）。于是扩展方法必然会被调用在视图上，
// 而视图的行跨度是**父 Mat 的** step：
//
//   - embind 的 *Ptr(row) 返回的是 step1(0) 个元素，不是本行的 cols × channels 个。
//     视图上它会越过本行，末行时越过整块缓冲区——那是一次静默的越界读写。
//     注意单行 ROI 的 isContinuous() 是 true，却同样中招，所以不能拿连续性当判据。
//   - .data* / DATA() 按连续内存直读（README 已有警告）；建立在它上面的 sum() /
//     reshapeRows() 因而读到的是错的元素。
//
// 期望值一律由父 Mat 的数据独立算出，不调用被测方法反推。

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** 3×3 父 Mat，值 1..9，类型默认 CV_8UC1。 */
function parent3(cv, type = "CV_8UC1") {
  return cv.matFromArray(3, 3, cv[type], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

test("PTR(row) 在 ROI 视图上只返回本行的 cols × channels 个元素", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 1, 2, 2)); // 覆盖 5,6 / 8,9
  try {
    assert.deepStrictEqual(Array.from(v.PTR(0)), [5, 6]);
    // 末行：step1(0) 长度的视图会越过父 Mat 的 9 字节缓冲区
    assert.deepStrictEqual(Array.from(v.PTR(1)), [8, 9]);
  } finally {
    v.delete();
    p.delete();
  }
});

test("PTR(row) 在单行 ROI 上同样只返回本行（它的 isContinuous() 是 true）", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 2, 2, 1)); // 最后一行的 8,9
  try {
    assert.strictEqual(
      v.isContinuous(),
      true,
      "前提：单行视图被 OpenCV 标为连续",
    );
    assert.deepStrictEqual(Array.from(v.PTR(0)), [8, 9]);
  } finally {
    v.delete();
    p.delete();
  }
});

test("replaceMatOnRow 在 ROI 视图上只写本行，不碰视图之外的像素", async () => {
  const cv = await getCv();
  const p = parent3(cv);
  const v = p.roi(new cv.Rect(1, 1, 2, 2));
  try {
    // 数组比本行长：多出的元素应被忽略。越界实现会把第三个值（99）写进视图之外。
    v.replaceMatOnRow([50, 60, 99], 0);
    v.replaceMatOnRow([80, 90, 99], 1);
    assert.deepStrictEqual(
      Array.from(p.DATA()),
      [1, 2, 3, 4, 50, 60, 7, 80, 90],
    );
  } finally {
    v.delete();
    p.delete();
  }
});

test("sum() 在 ROI 视图与列视图上是所含元素之和", async () => {
  const cv = await getCv();
  const p = parent3(cv, "CV_32FC1");
  const roi = p.roi(new cv.Rect(1, 1, 2, 2));
  const col = p.col(1);
  try {
    assert.strictEqual(roi.sum(), 5 + 6 + 8 + 9);
    assert.strictEqual(col.sum(), 2 + 5 + 8);
  } finally {
    roi.delete();
    col.delete();
    p.delete();
  }
});

test("reshapeRows() 在 ROI 视图上按视图内容重排", async () => {
  const cv = await getCv();
  const p = parent3(cv, "CV_32FC1");
  const v = p.roi(new cv.Rect(1, 1, 2, 2));
  let out;
  try {
    out = v.reshapeRows(1);
    assert.strictEqual(out.rows, 1);
    assert.strictEqual(out.cols, 4);
    assert.deepStrictEqual(Array.from(out.DATA()), [5, 6, 8, 9]);
  } finally {
    if (out) out.delete();
    v.delete();
    p.delete();
  }
});

// 放在最后：越界实现下它会真的改坏堆，不能让它连累同一进程里的其余用例。
test("replaceMatOnRow 在右下角视图的末行上不越界写堆", async () => {
  const cv = await getCv();
  // 2×64 的父 Mat，取右下角 1×1。越界时视图长度是 64，从父缓冲区最后一个字节
  // 往后写 63 字节——实测会改坏紧随其后分配的 Mat 的头部。
  const p = cv.matFromArray(2, 64, cv.CV_8UC1, new Array(128).fill(1));
  const neighbors = [];
  for (let k = 0; k < 8; k += 1) {
    neighbors.push(cv.matFromArray(2, 64, cv.CV_8UC1, new Array(128).fill(7)));
  }
  const v = p.roi(new cv.Rect(63, 1, 1, 1));
  try {
    // 传父 Mat 一整行那么长的数组：越界实现会照单全收，正确实现只写 1 个。
    v.replaceMatOnRow(new Array(64).fill(200), 0);
    assert.strictEqual(p.DATA()[127], 200);
    for (const m of neighbors) {
      assert.ok(
        Array.from(m.DATA()).every((x) => x === 7),
        "相邻 Mat 的数据被改动 —— replaceMatOnRow 越界写到了别人的堆",
      );
    }
  } finally {
    v.delete();
    p.delete();
    for (const m of neighbors) m.delete();
  }
});
