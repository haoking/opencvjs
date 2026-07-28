"use strict";

// 参数前置校验（src/js/guards.js）的守卫。
//
// 这批用例要钉住的不是「会抛异常」，而是**抛出物的形状**：
//
//   加 guards 之前，一个越界的 Rect 让 C++ 的 CV_Assert 走 abort，emscripten
//   把它转成 `throw 1914504` —— 一个裸数字。调用方 catch 到它之后：
//     e instanceof Error → false      e.message → undefined
//     e.message.includes(...) → TypeError: Cannot read properties of undefined
//   也就是说，调用方想「记一条日志再降级」都会让自己再崩一次，而那个数字对定位
//   问题毫无帮助。更糟的一类（越界的行列号）连 abort 都没有，直接静默改写别人的
//   堆内存。
//
// 因此每条用例都断言三件事：抛的是 Error 的子类、是正确的子类（TypeError 还是
// RangeError）、消息里同时有**实际收到的值**和**期望的集合/范围**。最后一条尤其
// 重要：一条不含实际值的错误消息，和那个裸数字相比只是没那么难看而已。

const test = require("node:test");
const assert = require("node:assert");
const { getCv } = require("../helpers");

/** 3×3 CV_32FC1，值 1..9。 */
function mat3(cv) {
  return cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

/**
 * 跑一个必然失败的调用，返回抛出物；并在这里就把「必须是 Error 子类」断言掉。
 * needles 里的每个片段都必须出现在 e.message 中。
 */
function assertGuard(fn, Ctor, needles, label) {
  let thrown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    thrown = e;
  }
  assert.ok(threw, `${label}: 没有抛出任何东西 —— 校验没生效`);
  assert.ok(
    thrown instanceof Error,
    `${label}: 抛出的不是 Error 实例，而是 ${typeof thrown} ${String(thrown)}` +
      `（这正是 guards 要消灭的形状）`,
  );
  assert.ok(
    thrown instanceof Ctor,
    `${label}: 期望 ${Ctor.name}，实际是 ${thrown.constructor.name}: ${thrown.message}`,
  );
  for (const needle of needles) {
    assert.ok(
      thrown.message.includes(needle),
      `${label}: 消息里缺少 "${needle}" —— 实际消息: ${thrown.message}`,
    );
  }
  return thrown;
}

// ---------------------------------------------------------------------------
// 前提：不加校验时，产物确实抛裸数字。
//
// 这条不是凑数——guards 的全部理由都建立在它上面。如果哪天换了产物、abort 改成
// 抛真正的 Error，这里会立刻失败，届时应当重新评估 guards 的必要性（而不是默默
// 保留一层已经没有理由的校验）。
// ---------------------------------------------------------------------------
test("前提：原生 roi() 越界时抛的是裸数字，不是 Error", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  let thrown;
  let threw = false;
  try {
    mat.roi(new cv.Rect(1, 1, 10, 10));
  } catch (e) {
    threw = true;
    thrown = e;
  } finally {
    mat.delete();
  }

  assert.ok(threw, "原生 roi() 越界居然没抛 —— guards 的前提变了，需重新评估");
  assert.strictEqual(
    thrown instanceof Error,
    false,
    `原生 abort 现在抛的是 Error（${thrown && thrown.constructor && thrown.constructor.name}）—— ` +
      `guards 的理由需要重写`,
  );
  assert.strictEqual(typeof thrown, "number", `实际抛出物: ${String(thrown)}`);
  assert.strictEqual(thrown.message, undefined);
});

test("abort 之后模块仍可用（所以问题是错误信息，不是模块报废）", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  try {
    mat.roi(new cv.Rect(1, 1, 10, 10));
  } catch (_) {
    /* 裸数字，忽略 */
  }
  const after = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  try {
    assert.deepStrictEqual(Array.from(after.DATA()), [1, 2, 3, 4]);
  } finally {
    mat.delete();
    after.delete();
  }
});

// ---------------------------------------------------------------------------
// 表驱动：每条都是一个「加 guards 之前会 abort 或静默写坏内存」的调用。
// ---------------------------------------------------------------------------
const CASES = [
  // —— Rect 越界（加 guards 前：abort，裸数字）——
  {
    name: "roiClone 的 Rect 超出右下边界",
    call: (cv, m) => m.roiClone(new cv.Rect(1, 1, 10, 10)),
    error: RangeError,
    needs: ["Mat.roiClone(rect)", "width=10", "cols=3", "rows=3"],
  },
  {
    name: "roiClone 的 Rect 有负坐标",
    call: (cv, m) => m.roiClone(new cv.Rect(-1, 0, 2, 2)),
    error: RangeError,
    needs: ["x=-1", "0 ≤ x"],
  },
  {
    name: "roiClone 收到的不是 Rect",
    call: (cv, m) => m.roiClone(undefined),
    error: TypeError,
    needs: ["Mat.roiClone(rect)", "undefined", "{x, y, width, height}"],
  },
  {
    name: "roiClone 的 Rect 字段是小数",
    call: (cv, m) => m.roiClone({ x: 0, y: 0, width: 1.5, height: 2 }),
    error: TypeError,
    needs: ["整数", "number 1.5"],
  },
  // —— 列 / 对角线下标越界（加 guards 前：abort 或畸形 Mat）——
  {
    name: "colClone 的列号越界",
    call: (cv, m) => m.colClone(9),
    error: RangeError,
    needs: ["Mat.colClone(col)", "col = 9", "0..2"],
  },
  {
    name: "colClone 的列号是小数（原本被静默截断）",
    call: (cv, m) => m.colClone(1.5),
    error: TypeError,
    needs: ["col 必须是整数", "number 1.5"],
  },
  {
    name: "diagClone 的对角线号越界",
    call: (cv, m) => m.diagClone(4),
    error: RangeError,
    needs: ["Mat.diagClone(d)", "d = 4", "-2..2"],
  },
  // —— 就地写入的下标越界（加 guards 前：静默写坏堆内存）——
  {
    name: "replaceMatOnRect 的 Rect 超出目标",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.replaceMatOnRect(src, new cv.Rect(2, 2, 2, 2));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.replaceMatOnRect(src, rect)", "x=2", "cols=3"],
  },
  {
    name: "replaceMatOnRect 的 src 装不下 rect",
    call: (cv, m) => {
      const src = cv.matFromArray(1, 1, cv.CV_32FC1, [1]);
      try {
        m.replaceMatOnRect(src, new cv.Rect(0, 0, 3, 3));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["src 是 1×1", "装不下 3×3"],
  },
  {
    name: "replaceMatOnRect 的 src 不是 Mat",
    call: (cv, m) => m.replaceMatOnRect({}, new cv.Rect(0, 0, 1, 1)),
    error: TypeError,
    needs: ["src 必须是 cv.Mat", "Object 实例"],
  },
  {
    name: "rectAdd 的 Rect 超出目标",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.rectAdd(src, new cv.Rect(2, 2, 2, 2));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.rectAdd(src, rect)", "rows=3"],
  },
  {
    name: "rectSubtract 的 Rect 超出目标",
    call: (cv, m) => {
      const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
      try {
        m.rectSubtract(src, new cv.Rect(0, 0, 4, 1));
      } finally {
        src.delete();
      }
    },
    error: RangeError,
    needs: ["Mat.rectSubtract(src, rect)", "width=4"],
  },
  {
    name: "replaceMatOnRow 的行号越界",
    call: (cv, m) => m.replaceMatOnRow([1, 2, 3], 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnRow(arr, row)", "row = 7", "0..2"],
  },
  {
    name: "replaceMatOnRow 的数组太短",
    call: (cv, m) => m.replaceMatOnRow([1], 0),
    error: RangeError,
    needs: ["arr 只有 1 个元素", "需要 3 个"],
  },
  {
    name: "replaceMatOnCol 的列号越界",
    call: (cv, m) => m.replaceMatOnCol([1, 2, 3], 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnCol(arr, col)", "col = 7"],
  },
  {
    name: "replaceMatOnCol 的数组太短",
    call: (cv, m) => m.replaceMatOnCol([1], 0),
    error: RangeError,
    needs: ["arr 只有 1 个元素", "需要 3 个"],
  },
  {
    name: "addOnCol 的列号越界",
    call: (cv, m) => m.addOnCol(1, 7),
    error: RangeError,
    needs: ["Mat.addOnCol(constant, col)", "col = 7"],
  },
  {
    name: "addOnCol 的常数不是有限数",
    call: (cv, m) => m.addOnCol(undefined, 0),
    error: TypeError,
    needs: ["constant 必须是有限数", "undefined"],
  },
  {
    name: "replaceMatOnPoint 的行列越界",
    call: (cv, m) => m.replaceMatOnPoint(99, 7, 7),
    error: RangeError,
    needs: ["Mat.replaceMatOnPoint(value, row, col)", "row = 7"],
  },
  {
    name: "replaceMatOnPoint 的 Point 越界",
    call: (cv, m) => m.replaceMatOnPoint(99, new cv.Point(9, 0)),
    error: RangeError,
    needs: ["col = 9", "0..2"],
  },
  // —— 标量运算的常数 ——
  {
    name: "addConstant 收到 undefined（原本静默产出整片 NaN）",
    call: (cv, m) => m.addConstant(undefined),
    error: TypeError,
    needs: ["Mat.addConstant(constant)", "有限数", "undefined"],
  },
  {
    name: "mulConstant 收到 NaN",
    call: (cv, m) => m.mulConstant(NaN),
    error: TypeError,
    needs: ["有限数", "number NaN"],
  },
  {
    name: "constantDivide 收到字符串",
    call: (cv, m) => m.constantDivide("2"),
    error: TypeError,
    needs: ["有限数", 'string "2"'],
  },
  {
    name: "constantSubtract 收到 Infinity",
    call: (cv, m) => m.constantSubtract(Infinity),
    error: TypeError,
    needs: ["有限数", "Infinity"],
  },
  // —— norm2 的尺寸 / 类型不匹配（加 guards 前：cv.subtract abort，裸数字）——
  {
    name: "norm2 两个 Mat 尺寸不同",
    call: (cv, m) => {
      const b = cv.matFromArray(1, 3, cv.CV_32FC1, [1, 2, 3]);
      try {
        cv.norm2(m, b);
      } finally {
        b.delete();
      }
    },
    error: RangeError,
    needs: ["cv.norm2(src1, src2, normType)", "src1 是 3×3", "src2 是 1×3"],
  },
  {
    name: "norm2 两个 Mat 类型不同",
    call: (cv, m) => {
      const b = cv.matFromArray(3, 3, cv.CV_8UC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      try {
        cv.norm2(m, b);
      } finally {
        b.delete();
      }
    },
    error: TypeError,
    needs: ["CV_32FC1", "CV_8UC1", "类型必须一致"],
  },
  {
    name: "norm2 收到非 Mat",
    call: (cv) => cv.norm2(1, 2),
    error: TypeError,
    needs: ["src1 必须是 cv.Mat", "number 1"],
  },
  // —— dftSplit 的通道数 ——
  {
    name: "dftSplit 在多通道 Mat 上（只会读通道 0，静默返回垃圾）",
    call: (cv) => {
      const m2 = cv.matFromArray(2, 2, cv.CV_32FC2, [1, 2, 3, 4, 5, 6, 7, 8]);
      try {
        m2.dftSplit();
      } finally {
        m2.delete();
      }
    },
    error: TypeError,
    needs: ["Mat.dftSplit()", "CV_32FC2", "只接受 1 通道", "实际收到 2 通道"],
  },
  // —— matFromArray 的元素个数 ——
  {
    name: "matFromArray 元素不足（原本静默返回未初始化的堆内存）",
    call: (cv) => cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3]),
    error: RangeError,
    needs: ["cv.matFromArray", "需要 9 个元素", "实际收到 3 个"],
  },
  {
    name: "matFromArray 多通道时元素个数按通道算",
    call: (cv) => cv.matFromArray(2, 2, cv.CV_32FC3, [1, 2, 3, 4]),
    error: RangeError,
    needs: ["CV_32FC3", "需要 12 个元素", "2×2×3 通道"],
  },
  {
    name: "matFromArray 的 array 不是数组",
    call: (cv) => cv.matFromArray(1, 1, cv.CV_32FC1, 5),
    error: TypeError,
    needs: ["array 必须是数组或 TypedArray", "number 5"],
  },
  // —— PTR 自己的边界（它是文档化的公开 API，用户会绕开上面那些方法直接调）——
  {
    name: "PTR(row, col) 行列都越界",
    call: (cv, m) => m.PTR(9, 9),
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "row = 9", "0..2"],
  },
  {
    name: "PTR(row) 行形式越界",
    call: (cv, m) => m.PTR(9),
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "row = 9", "0..2"],
  },
  {
    name: "PTR 只有列越界",
    call: (cv, m) => m.PTR(0, 3),
    error: RangeError,
    needs: ["col = 3", "0..2"],
  },
  {
    name: "PTR 的负行号",
    call: (cv, m) => m.PTR(-1, 0),
    error: RangeError,
    needs: ["row = -1"],
  },
  {
    // 1.x 到 2.0 之间，col 的缺省值是 -1、判据是 col < 0，于是 PTR(0, -1) 被当成
    // 「取整行」而不是报错。缺省值已改为 undefined，负列号一律如实报越界。
    name: "PTR 的负列号（旧实现把 -1 当成取整行的哨兵）",
    call: (cv, m) => m.PTR(0, -1),
    error: RangeError,
    needs: ["col = -1", "0..2"],
  },
  {
    name: "PTR 的小数行号（原本被静默截断成第 1 行）",
    call: (cv, m) => m.PTR(1.5, 0),
    error: TypeError,
    needs: ["row 必须是整数", "number 1.5"],
  },
  {
    name: "PTR 的小数列号",
    call: (cv, m) => m.PTR(0, 1.5),
    error: TypeError,
    needs: ["col 必须是整数", "number 1.5"],
  },
  {
    name: "空 Mat 上的 PTR",
    call: (cv) => new cv.Mat().PTR(0, 0),
    error: RangeError,
    needs: ["Mat.PTR(row, col)", "该 Mat 在这个方向上是空的"],
  },
];

for (const c of CASES) {
  test(`guards: ${c.name}`, async () => {
    const cv = await getCv();
    const mat = mat3(cv);
    try {
      assertGuard(() => c.call(cv, mat), c.error, c.needs, c.name);
    } finally {
      mat.delete();
    }
  });
}

// ---------------------------------------------------------------------------
// 已被 delete() 的 Mat。
//
// 这一类和上面几类不同：embind 本来就抛 BindingError（是 Error 实例、消息可读），
// 所以 guards 在这里补的不是「可捕获性」，而是 embind 说不出的那半句——是哪个
// 函数的哪个参数。下面同时钉住这两点。
// ---------------------------------------------------------------------------
test("guards: 用已 delete() 的 Mat 调用扩展方法，报出函数名与参数名", async () => {
  const cv = await getCv();
  const dead = mat3(cv);
  dead.delete();

  const calls = [
    ["Mat.roiClone(rect)", () => dead.roiClone(new cv.Rect(0, 0, 1, 1))],
    ["Mat.colClone(col)", () => dead.colClone(0)],
    ["Mat.diagClone(d)", () => dead.diagClone()],
    ["Mat.sum()", () => dead.sum()],
    ["Mat.reshapeRows(rows)", () => dead.reshapeRows(1)],
    ["Mat.addConstant(constant)", () => dead.addConstant(1)],
    ["Mat.dftSplit()", () => dead.dftSplit()],
    ["Mat.addOnCol(constant, col)", () => dead.addOnCol(1, 0)],
  ];
  for (const [where, fn] of calls) {
    assertGuard(fn, TypeError, [where, "已被 delete()"], where);
  }
});

test("guards: 第二个参数是已 delete() 的 Mat 时，指名道姓地报 src", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const dead = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  dead.delete();
  try {
    assertGuard(
      () => mat.replaceMatOnRect(dead, new cv.Rect(0, 0, 2, 2)),
      TypeError,
      ["Mat.replaceMatOnRect(src, rect)", "src 已被 delete()"],
      "replaceMatOnRect(dead src)",
    );
    assertGuard(
      () => cv.norm2(mat, dead),
      TypeError,
      ["cv.norm2(src1, src2, normType)", "src2 已被 delete()"],
      "norm2(dead src2)",
    );
  } finally {
    mat.delete();
  }
});

// ---------------------------------------------------------------------------
// 校验必须只拦下真正的错误：合法调用一个都不能被误伤。
// （全类型 × 全通道的正确性由 test/types 与 test/unit 的其余用例覆盖，这里只钉
// 那些正好落在边界上、最容易被写错的校验的输入。）
// ---------------------------------------------------------------------------
test("guards: 贴边但合法的输入不受影响", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const kept = [];
  try {
    // Rect 正好铺满整个 Mat
    kept.push(mat.roiClone(new cv.Rect(0, 0, 3, 3)));
    // 空 Rect 是 OpenCV 允许的
    kept.push(mat.roiClone(new cv.Rect(1, 1, 0, 0)));
    // 最后一列、两端的对角线
    kept.push(mat.colClone(2));
    kept.push(mat.diagClone(2));
    kept.push(mat.diagClone(-2));
    // 最后一行 / 最后一个像素
    mat.replaceMatOnRow([1, 2, 3], 2);
    mat.replaceMatOnPoint(0, 2, 2);
    mat.addOnCol(0, 2);
    // 负数常数、0 都是有限数
    kept.push(mat.addConstant(-1.5));
    kept.push(mat.mulConstant(0));

    assert.strictEqual(kept[0].rows, 3);
    assert.strictEqual(kept[1].rows, 0, "空 Rect 应得到空 Mat");
    // colClone 是在下面那次 replaceMatOnRow 之前取的副本，因此仍是原始的第 2 列
    assert.deepStrictEqual(Array.from(kept[2].DATA()), [3, 6, 9]);

    // PTR 的两种合法形式，以及贴边的下标。
    // 此刻 mat 的第 2 行是上面 replaceMatOnRow([1,2,3], 2) 写进去的，随后
    // replaceMatOnPoint(0, 2, 2) 把 (2,2) 改成了 0；addConstant / mulConstant
    // 返回新 Mat，不动源。
    assert.deepStrictEqual(Array.from(mat.PTR(2)), [1, 2, 0]);
    assert.deepStrictEqual(Array.from(mat.PTR(2, 2)), [0]);
    assert.deepStrictEqual(Array.from(mat.PTR(0, 0)), [1]);
    // 显式传 undefined 与省略参数等价（行形式）
    assert.deepStrictEqual(Array.from(mat.PTR(2, undefined)), [1, 2, 0]);
  } finally {
    mat.delete();
    for (const m of kept) m.delete();
  }
});

// ---------------------------------------------------------------------------
// 就地写入的那批方法在**入口**就把下标校验掉了，循环里走的是 access.rawPtr() 取到
// 的原生访问器，不再逐像素过 PTR()。这两条守卫钉住这个分工的两端。
// ---------------------------------------------------------------------------
test("guards: 就地写入方法报的是自己的函数名，不是 Mat.PTR", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const src = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
  try {
    // 入口校验必须先于任何 PTR 调用触发——否则错误消息会退化成 Mat.PTR(...)，
    // 调用方就看不出到底是哪个 API 用错了。
    const cases = [
      ["Mat.addOnCol(constant, col)", () => mat.addOnCol(1, 7)],
      [
        "Mat.replaceMatOnCol(arr, col)",
        () => mat.replaceMatOnCol([1, 2, 3], 7),
      ],
      [
        "Mat.replaceMatOnRow(arr, row)",
        () => mat.replaceMatOnRow([1, 2, 3], 7),
      ],
      [
        "Mat.replaceMatOnPoint(value, row, col)",
        () => mat.replaceMatOnPoint(1, 7, 7),
      ],
      [
        "Mat.replaceMatOnRect(src, rect)",
        () => mat.replaceMatOnRect(src, new cv.Rect(2, 2, 2, 2)),
      ],
      [
        "Mat.rectAdd(src, rect)",
        () => mat.rectAdd(src, new cv.Rect(2, 2, 2, 2)),
      ],
      [
        "Mat.rectSubtract(src, rect)",
        () => mat.rectSubtract(src, new cv.Rect(2, 2, 2, 2)),
      ],
    ];
    for (const [where, fn] of cases) {
      const e = assertGuard(fn, RangeError, [where], where);
      assert.ok(
        !e.message.includes("Mat.PTR"),
        `${where}: 错误来自 PTR 而不是入口校验 —— 消息: ${e.message}`,
      );
    }
  } finally {
    mat.delete();
    src.delete();
  }
});

test("guards: 逐像素循环不经过 PTR()（经过就是每像素多两次 embind 调用）", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  const src = cv.matFromArray(2, 2, cv.CV_32FC1, [10, 20, 30, 40]);
  const realPTR = cv.Mat.prototype.PTR;
  // 把 PTR 换成地雷：循环里只要碰它一次就炸。这是唯一能观察到「循环走没走
  // rawPtr」的办法，而这正是最容易被后来的改动悄悄改回去的地方——实测走 PTR
  // 会让 replaceMatOnRect 慢 82%（同进程轮换 6 轮、丢首轮、取最小值）。
  cv.Mat.prototype.PTR = function () {
    throw new Error("循环里调了 PTR()");
  };
  try {
    mat.replaceMatOnRect(src, new cv.Rect(1, 1, 2, 2));
    mat.rectAdd(src, new cv.Rect(1, 1, 2, 2));
    mat.rectSubtract(src, new cv.Rect(1, 1, 2, 2));
    mat.replaceMatOnCol([1, 2, 3], 0);
    mat.addOnCol(1, 0);
    // 手算：[1..9] → replaceMatOnRect 把 (1,1)(1,2)(2,1)(2,2) 换成 10,20,30,40
    // → rectAdd 再加一遍 → rectSubtract 再减回去 → replaceMatOnCol 把第 0 列
    // 写成 1,2,3 → addOnCol 第 0 列各加 1。
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [2, 2, 3, 3, 10, 20, 4, 30, 40],
      "绕开 PTR 之后写入结果不对",
    );
  } finally {
    cv.Mat.prototype.PTR = realPTR;
    mat.delete();
    src.delete();
  }
});

test("guards: 重复加载不会把 matFromArray 一层层包起来，PTR 也不会被重复包装", async () => {
  const path = require("path");
  const { DIST } = require("../helpers");
  // loadOpenCV() 可以被调用多次（两个模块各写一句 await require(...)() 就够了），
  // 而 cv 是 require 缓存里的同一个对象。挂 prototype 的那些扩展天然幂等，
  // 只有 matFromArray 是包裹——不设幂等就会一次调用层层叠加。
  const loadCV = require(path.join(DIST, "index.js"));
  const cv = await loadCV();
  const first = cv.matFromArray;
  const firstPTR = cv.Mat.prototype.PTR;
  await loadCV();
  assert.strictEqual(
    cv.matFromArray,
    first,
    "第二次加载又包了一层 matFromArray",
  );
  assert.strictEqual(cv.matFromArray.guarded, true);
  // PTR 的校验是写在函数体里的、不是包裹上去的，所以重装只是重新赋一次值，
  // 天然幂等：既不会叠加校验，行为也完全一致。
  assert.strictEqual(
    typeof cv.Mat.prototype.PTR,
    "function",
    "重复加载后 PTR 丢了",
  );
  assert.throws(
    () => cv.matFromArray(2, 2, cv.CV_8UC1, [1, 2, 3, 4]).PTR(9, 9),
    RangeError,
    "重复加载后 PTR 的边界校验失效",
  );
  assert.strictEqual(
    firstPTR.length,
    cv.Mat.prototype.PTR.length,
    "重复加载后 PTR 的形参个数变了 —— 可能被包了一层",
  );
  // 包装仍然生效，且合法调用照常
  assert.throws(() => cv.matFromArray(2, 2, cv.CV_8UC1, [1]), RangeError);
  const m = cv.matFromArray(2, 2, cv.CV_8UC1, [1, 2, 3, 4]);
  try {
    assert.deepStrictEqual(Array.from(m.DATA()), [1, 2, 3, 4]);
  } finally {
    m.delete();
  }
});

test("guards: 拦下一次错误调用后，Mat 与模块都完好", async () => {
  const cv = await getCv();
  const mat = mat3(cv);
  try {
    assert.throws(() => mat.replaceMatOnRect(mat, new cv.Rect(2, 2, 2, 2)));
    assert.throws(() => mat.addOnCol(NaN, 0));
    assert.throws(() => mat.colClone(99));

    // 数据一个字节都没被动过——校验是在任何写入之前完成的
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      "校验失败的调用不应该已经写进去一部分",
    );
    // 后续正常调用照常
    mat.replaceMatOnPoint(99, 1, 1);
    assert.deepStrictEqual(
      Array.from(mat.DATA()),
      [1, 2, 3, 4, 99, 6, 7, 8, 9],
    );
  } finally {
    mat.delete();
  }
});
