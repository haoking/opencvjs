"use strict";

// 就地写入方法（replaceMatOnRect / rectAdd / rectSubtract / replaceMatOnCol / addOnCol /
// replaceMatOnRow / replaceMatOnPoint）的数值语义与寻址。
//
// 期望值依据：
//   - 写进整型 Mat 的值按 OpenCV 的 saturate_cast 处理——四舍六入五成双（cvRound
//     的舍入规则），再钳到该 depth 的取值范围，NaN 得 0。这也是同一个库里
//     addConstant / mulConstant 等（走 OpenCV 的 convertTo）一直以来的行为。
//     旧实现直接赋给 TypedArray：按模 2^n 回绕、小数截断（250 + 20 写进 8U 得 14）。
//   - 浮点 Mat 原样写入（NaN / ±Infinity 保留）。
//   - src 与 this 共享内存时按「先整体读出 src、再写」的拷贝语义。
//   - 只写通道 0（replaceMatOnRow 除外，它写整行的所有通道）。
//
// 期望值一律手算，不调用被测方法反推。

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** 建 Mat，跑 fn，返回数据，结束后释放。 */
async function run(type, rows, cols, data, fn) {
  const cv = await getCv();
  const m = cv.matFromArray(rows, cols, cv[type], data);
  try {
    fn(m, cv);
    return Array.from(m.DATA());
  } finally {
    m.delete();
  }
}

test("addOnCol / rectAdd / rectSubtract 在 8U 上饱和，不回绕", async () => {
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [10, 250], (m) => m.addOnCol(20, 0)),
    [30, 255],
  );
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [10, 250], (m) => m.addOnCol(-20, 0)),
    [0, 230],
  );
  const cv = await getCv();
  const src = cv.matFromArray(1, 2, cv.CV_8UC1, [100, 100]);
  try {
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 2, [200, 10], (m) =>
        m.rectAdd(src, new cv.Rect(0, 0, 2, 1)),
      ),
      [255, 110],
    );
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 2, [200, 10], (m) =>
        m.rectSubtract(src, new cv.Rect(0, 0, 2, 1)),
      ),
      [100, 0],
    );
  } finally {
    src.delete();
  }
});

test("写进整型 Mat 的小数按四舍六入五成双舍入", async () => {
  // 10.7 → 11；2.5 → 2；3.5 → 4（.5 取偶，与 cvRound 一致）
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 1, [10, 2, 3], (m) => m.addOnCol(0.7, 0)),
    [11, 3, 4],
  );
  assert.deepStrictEqual(
    await run("CV_8UC1", 2, 1, [2, 3], (m) => m.addOnCol(0.5, 0)),
    [2, 4],
  );
  assert.deepStrictEqual(
    await run("CV_16SC1", 2, 1, [-2, -3], (m) => m.addOnCol(-0.5, 0)),
    [-2, -4],
  );
});

test("replaceMatOnRect 把浮点 src 写进 8U 时饱和、舍入，NaN 得 0", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(1, 4, cv.CV_32FC1, [300.7, -5, 2.5, NaN]);
  try {
    assert.deepStrictEqual(
      await run("CV_8UC1", 1, 4, [1, 1, 1, 1], (m) =>
        m.replaceMatOnRect(src, new cv.Rect(0, 0, 4, 1)),
      ),
      [255, 0, 2, 0],
    );
  } finally {
    src.delete();
  }
});

test("replaceMatOnCol / replaceMatOnRow / replaceMatOnPoint 写进 8S 时饱和", async () => {
  assert.deepStrictEqual(
    await run("CV_8SC1", 3, 1, [0, 0, 0], (m) =>
      m.replaceMatOnCol([200, -200, 1.5], 0),
    ),
    [127, -128, 2],
  );
  assert.deepStrictEqual(
    await run("CV_8SC1", 1, 3, [0, 0, 0], (m) =>
      m.replaceMatOnRow([200, -200, 1.5], 0),
    ),
    [127, -128, 2],
  );
  assert.deepStrictEqual(
    await run("CV_8SC1", 1, 1, [0], (m) => m.replaceMatOnPoint(-1000, 0, 0)),
    [-128],
  );
});

test("CV_32S 上的就地写入同样饱和（不溢出成 INT_MIN）", async () => {
  assert.deepStrictEqual(
    await run("CV_32SC1", 2, 1, [2147483647, -2147483648], (m) =>
      m.addOnCol(10, 0),
    ),
    [2147483647, -2147483638],
  );
});

test("浮点 Mat 原样写入：±Infinity 与 NaN 保留", async () => {
  const got = await run("CV_32FC1", 3, 1, [1, 2, 3], (m) => {
    m.replaceMatOnCol([Infinity, -Infinity, NaN], 0);
  });
  assert.strictEqual(got[0], Infinity);
  assert.strictEqual(got[1], -Infinity);
  assert.ok(Number.isNaN(got[2]));
});

test("src 与 this 是同一个 Mat 时按拷贝语义（先读完 src 再写）", async () => {
  const cv = await getCv();
  const rect = new cv.Rect(1, 1, 2, 2);
  // 3×3 [1..9]，把左上 2×2（1,2 / 4,5）写进右下 2×2
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) =>
      m.replaceMatOnRect(m, rect),
    ),
    [1, 2, 3, 4, 1, 2, 7, 4, 5],
  );
  // 右下 2×2 分别加上原来的左上 2×2：5+1, 6+2, 8+4, 9+5
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) =>
      m.rectAdd(m, rect),
    ),
    [1, 2, 3, 4, 6, 8, 7, 12, 14],
  );
});

test("src 是 this 的视图、且与写入区重叠时也按拷贝语义", async () => {
  const cv = await getCv();
  assert.deepStrictEqual(
    await run("CV_8UC1", 3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], (m) => {
      const view = m.roi(new cv.Rect(0, 0, 2, 2));
      try {
        m.replaceMatOnRect(view, new cv.Rect(1, 1, 2, 2));
      } finally {
        view.delete();
      }
    }),
    [1, 2, 3, 4, 1, 2, 7, 4, 5],
  );
});

test("dst 是原生 roi() 视图时按视图自己的位置与行跨度写入", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(2, 2, cv.CV_16SC1, [10, 20, 30, 40]);
  try {
    // 4×4 父 Mat 全 0，视图取 Rect(1,1,3,2)；在视图的 Rect(1,0,2,2) 上累加 src，
    // 落到父 Mat 的 (1,2)(1,3)(2,2)(2,3)
    const got = await run("CV_16SC1", 4, 4, new Array(16).fill(0), (m) => {
      const view = m.roi(new cv.Rect(1, 1, 3, 2));
      try {
        view.rectAdd(src, new cv.Rect(1, 0, 2, 2));
        view.addOnCol(5, 0); // 视图第 0 列 = 父 Mat 第 1 列的第 1、2 行
      } finally {
        view.delete();
      }
    });
    // prettier-ignore
    assert.deepStrictEqual(got, [
      0, 0, 0, 0,
      0, 5, 10, 20,
      0, 5, 30, 40,
      0, 0, 0, 0,
    ]);
  } finally {
    src.delete();
  }
});

test("多通道上只写通道 0（replaceMatOnRow 写整行的所有通道）", async () => {
  const cv = await getCv();
  const src = cv.matFromArray(1, 1, cv.CV_16SC2, [7, 8]);
  try {
    assert.deepStrictEqual(
      await run("CV_16SC2", 1, 2, [1, 2, 3, 4], (m) => {
        m.rectAdd(src, new cv.Rect(1, 0, 1, 1));
        m.addOnCol(100, 0);
      }),
      [101, 2, 10, 4],
    );
    assert.deepStrictEqual(
      await run("CV_16SC2", 2, 1, [1, 2, 3, 4], (m) =>
        m.replaceMatOnRow([9, 9], 1),
      ),
      [1, 2, 9, 9],
    );
  } finally {
    src.delete();
  }
});
