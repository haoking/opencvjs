"use strict";

/**
 * 区域操作与就地写入。
 *
 * 分两组：
 *  1. roiClone / colClone / diagClone —— 取子区域的**独立副本**
 *  2. replaceMatOn* / rectAdd / rectSubtract / addOnCol —— 就地改写调用者自身
 *
 * 第 2 组全部是逐像素写入，而且按地址直接读写 wasm 堆（typed-access 的 pixels()），
 * 途中没有任何边界检查——越界即静默改写别人的堆内存。所以每个函数在**入口**先过一遍
 * guards 校验，把整个循环的下标范围一次性证明掉；循环内不再有任何校验。
 *
 * 为什么不在循环里调 PTR()（它自己也查边界）或原生的 *Ptr()：每个像素都要跨一次
 * 语言边界、再新建一个 TypedArray。按地址直接写快上百倍，倍数以 `npm run bench`
 * 的 inplace-ops 门禁每次打印的「退化参照」为准，别在注释里另抄一份。
 *
 * 写进整型 Mat 的值一律按 OpenCV 的 saturate_cast 饱和（四舍六入五成双、钳到取值
 * 范围、NaN 得 0），与 addConstant 等走 OpenCV 的方法一致；浮点 Mat 原样写入。
 */

/**
 * 原生 roi()/col()/diag() 返回非连续视图，此时 .data* / DATA() 会按连续内存
 * 直读，得到错误数据（3×3 CV_32FC2 上 col(2) 读出 5,6,7,8,9,10，正确值是
 * 5,6,11,12,17,18 —— 已在新 wasm 产物上复现确认）。
 *
 * 1.x 曾把这层修复直接盖在原生 roi()/col()/diag() 上，代价是原生的视图语义
 * （`mat.roi(r).setTo(...)` 写回源 Mat）被静默改掉。2.0 不再覆盖原生方法：
 * 修复版以独立名字提供，原生三个方法保持原样。
 */
function cloneAndRelease(view) {
  try {
    return view.clone();
  } finally {
    view.delete();
  }
}

/**
 * src 被读的字节区间与 dst 被写的字节区间是否相交。
 *
 * 两者可能是同一个 Mat，或者同一块父 Mat 上的两个视图。按行主序边读边写时，一旦
 * 重叠，后面的像素就会读到前面刚写进去的值（3×3 上把自己的 Rect(0,0,2,2) 写进
 * Rect(1,1,2,2)，右下角得 1 而不是 5）。按首尾字节做保守判断：交错而实际不相交的
 * 两个视图也会被当成重叠，代价只是多拷一次。d / s 是 typed-access 的 pixels() 给出
 * 的地址（用其中的字节版字段），不再另读 embind getter。
 */
function overlaps(d, x, y, s, w, h) {
  const dStart = d.byteOffset + y * d.rowBytes + x * d.pixelBytes;
  const dEnd = dStart + (h - 1) * d.rowBytes + w * d.pixelBytes;
  const sEnd = s.byteOffset + (h - 1) * s.rowBytes + w * s.pixelBytes;
  return dStart < sEnd && s.byteOffset < dEnd;
}

/**
 * 两个逐行内核：dh[di..] 是目标行的通道 0，sh[si..] 是源行的通道 0，各按自己的像素
 * 跨度前进 n 个像素。sat 为 null 时（浮点目标）原样写，否则写之前饱和。
 *
 * 拆成两个固定形状的小函数、而不是传一个 (dst, src) => 值 的回调进去：那个回调在三个
 * 方法之间共用一个调用点，V8 见到三种闭包就不再内联，实测 rectAdd 因此比
 * replaceMatOnRect 慢 2.5 倍。加与减共用一个内核，用 sign 区分（乘 ±1 是精确的）。
 */
function copyRow(dh, di, dStep, sh, si, sStep, n, sat) {
  if (sat === null) {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) dh[di] = sh[si];
  } else {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] = sat(sh[si]);
    }
  }
}

function addRow(dh, di, dStep, sh, si, sStep, n, sat, sign) {
  if (sat === null) {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] += sign * sh[si];
    }
  } else {
    for (let j = 0; j < n; j += 1, di += dStep, si += sStep) {
      dh[di] = sat(dh[di] + sign * sh[si]);
    }
  }
}

/**
 * 把 s 描述的区域逐行写进 d 描述的区域（都只动通道 0）：sign 为 0 时拷贝，为 ±1 时
 * 累加 / 相减。d、s 是 typed-access 的 pixels() 的返回值，(x, y) 是 d 里的起点，
 * w × h 是区域大小。
 *
 * 单独成函数，而且常见路径上不包在 try/finally 里：实测同一段循环放进 try 块里要慢
 * 1.7 倍（V8 对 try 块里的调用不做同样的优化）。只有「src 与 dst 重叠、先拷了一份」
 * 那条罕见路径才需要 finally 来释放那份拷贝。
 */
function writeRect(d, s, x, y, w, h, sign) {
  const dh = d.heap;
  const sh = s.heap;
  for (let i = 0; i < h; i += 1) {
    const di = d.base + (y + i) * d.rowStep + x * d.pixelStep;
    const si = s.base + i * s.rowStep;
    if (sign === 0) {
      copyRow(dh, di, d.pixelStep, sh, si, s.pixelStep, w, d.saturate);
    } else {
      addRow(dh, di, d.pixelStep, sh, si, s.pixelStep, w, d.saturate, sign);
    }
  }
}

module.exports = function applyMatRegion(cv, guards, access) {
  /** 子矩形的独立副本（原生 roi() 的可安全直读版本）。 */
  cv.Mat.prototype.roiClone = function roiClone(rect) {
    const where = "Mat.roiClone(rect)";
    guards.mat(this, "接收者 Mat", where);
    guards.rect(this, rect, where);
    return cloneAndRelease(this.roi(rect));
  };

  /** 第 d 列的独立副本（原生 col() 的可安全直读版本）。 */
  cv.Mat.prototype.colClone = function colClone(d) {
    const where = "Mat.colClone(col)";
    guards.mat(this, "接收者 Mat", where);
    guards.index(d, this.cols, "col", where);
    return cloneAndRelease(this.col(d));
  };

  /** 第 d 条对角线的独立副本（原生 diag() 的可安全直读版本）。 */
  cv.Mat.prototype.diagClone = function diagClone(d = 0) {
    const where = "Mat.diagClone(d)";
    guards.mat(this, "接收者 Mat", where);
    guards.diagIndex(this, d, where);
    return cloneAndRelease(this.diag(d));
  };

  /**
   * 三个矩形就地写入的公共部分：入口校验 → 重叠时先拷一份 src → 逐行写通道 0。
   * sign 为 0 时把 src 拷进来，为 ±1 时把 ±src 累加上去。
   */
  function rectInPlace(dst, src, rect, where, sign) {
    guards.mat(dst, "接收者 Mat", where);
    guards.mat(src, "src", where);
    guards.rect(dst, rect, where);
    guards.covers(src, rect, "src", where);
    // 只读这一次：循环里不再碰 rect（它可能是任意带 getter 的对象）。
    const { x, y, width: w, height: h } = rect;
    if (w === 0 || h === 0) return;

    // 深度不支持时在这里就报错，不白拷一份。
    const d = access.pixels(dst, where);
    const s = access.pixels(src, where);
    if (!overlaps(d, x, y, s, w, h)) {
      writeRect(d, s, x, y, w, h, sign);
      return;
    }
    // src 与写入区重叠：先拷一份。clone 可能让 wasm 内存增长、刚才取到的堆视图随之
    // 失效，所以两边的地址都在拷完之后重取（见 pixels() 的说明）。
    const copy = src.roiClone(new cv.Rect(0, 0, w, h));
    try {
      writeRect(
        access.pixels(dst, where),
        access.pixels(copy, where),
        x,
        y,
        w,
        h,
        sign,
      );
    } finally {
      copy.delete();
    }
  }

  /** 把 src1 的通道 0 拷进 this 由 rect 指定的矩形区域（就地）。 */
  cv.Mat.prototype.replaceMatOnRect = function replaceMatOnRect(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.replaceMatOnRect(src, rect)", 0);
  };

  /**
   * 用 arr 覆盖第 d 行的全部元素（cols × channels 个，就地）。
   *
   * 1.x 硬编码 this.floatPtr(d)，非 CV_32F 的 Mat 直接抛异常；2.0 起 7 种深度
   * 全部可用。
   */
  cv.Mat.prototype.replaceMatOnRow = function replaceMatOnRow(arr, d) {
    const where = "Mat.replaceMatOnRow(arr, row)";
    guards.mat(this, "接收者 Mat", where);
    guards.index(d, this.rows, "row", where);
    const n = this.cols * this.channels();
    guards.arrayLike(arr, n, "arr", where);
    const { heap, base, rowStep, saturate } = access.pixels(this, where);
    // 一行之内的元素是连续的，视图也一样（只有行与行之间隔着父 Mat 的跨度）。
    const start = base + d * rowStep;
    for (let i = 0; i < n; i += 1) {
      const v = +arr[i];
      heap[start + i] = saturate === null ? v : saturate(v);
    }
  };

  /** 用 arr 覆盖第 d 列的通道 0（就地）。 */
  cv.Mat.prototype.replaceMatOnCol = function replaceMatOnCol(arr, d) {
    const where = "Mat.replaceMatOnCol(arr, col)";
    guards.mat(this, "接收者 Mat", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    guards.arrayLike(arr, rows, "arr", where);
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    let k = base + d * pixelStep;
    for (let i = 0; i < rows; i += 1, k += rowStep) {
      const v = +arr[i];
      heap[k] = saturate === null ? v : saturate(v);
    }
  };

  /**
   * 写单个位置的通道 0（就地）。
   *
   *   replaceMatOnPoint(value, row, col)
   *   replaceMatOnPoint(value, point)      // cv.Point 约定：x = 列、y = 行
   *
   * 1.x 的形参名是 (constant, x, y) 而内部是 PTR(x, y) —— x 实为行号、y 为
   * 列号，与参数名给人的印象相反；README 里记的 (value, point) 重载则根本
   * 不存在（传对象抛 TypeError）。这里把两者一并对齐。
   */
  cv.Mat.prototype.replaceMatOnPoint = function replaceMatOnPoint(
    value,
    rowOrPoint,
    col,
  ) {
    const where = "Mat.replaceMatOnPoint(value, row, col)";
    guards.mat(this, "接收者 Mat", where);
    // value 是写进这一格的数据，不是作用到整个 Mat 上的运算数：NaN 放行。
    guards.value(value, "value", where);

    let row = rowOrPoint;
    let column = col;
    if (rowOrPoint !== null && typeof rowOrPoint === "object") {
      row = rowOrPoint.y;
      column = rowOrPoint.x;
    } else if (col === undefined) {
      // 这条消息 README 里逐字引用过，改动前先改文档。
      throw new TypeError(
        "replaceMatOnPoint(value, row, col) 或 replaceMatOnPoint(value, point)：缺少 col",
      );
    }
    guards.index(row, this.rows, "row", where);
    guards.index(column, this.cols, "col", where);
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    const k = base + row * rowStep + column * pixelStep;
    heap[k] = saturate === null ? value : saturate(value);
  };

  /** 给第 d 列的通道 0 逐行加上 constant（就地）。 */
  cv.Mat.prototype.addOnCol = function addOnCol(constant, d) {
    const where = "Mat.addOnCol(constant, col)";
    guards.mat(this, "接收者 Mat", where);
    guards.number(constant, "constant", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    const { heap, base, rowStep, pixelStep, saturate } = access.pixels(
      this,
      where,
    );
    let k = base + d * pixelStep;
    for (let i = 0; i < rows; i += 1, k += rowStep) {
      const v = heap[k] + constant;
      heap[k] = saturate === null ? v : saturate(v);
    }
  };

  /** 把 src1 的通道 0 累加到 this 由 rect 指定的矩形区域（就地）。 */
  cv.Mat.prototype.rectAdd = function rectAdd(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.rectAdd(src, rect)", 1);
  };

  /** 把 src1 的通道 0 从 this 由 rect 指定的矩形区域中减去（就地）。 */
  cv.Mat.prototype.rectSubtract = function rectSubtract(src1, rect) {
    rectInPlace(this, src1, rect, "Mat.rectSubtract(src, rect)", -1);
  };
};
