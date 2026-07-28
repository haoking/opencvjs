"use strict";

/**
 * 区域操作与就地写入。
 *
 * 分两组：
 *  1. roiClone / colClone / diagClone —— 取子区域的**独立副本**
 *  2. replaceMatOn* / rectAdd / rectSubtract / addOnCol —— 就地改写调用者自身
 *
 * 第 2 组全部是逐像素写入，而 embind 的 *Ptr() 不查边界（越界即静默改写别人的
 * 堆内存）。所以每个函数在**入口**先过一遍 guards 校验，把整个循环的下标范围
 * 一次性证明掉；循环内不再有任何校验，直接用 access.rawPtr() 在循环外取到的原生
 * 访问器名。
 *
 * 为什么不在循环里调 PTR()（它自己也查边界）：那是重复校验，而且不便宜——它要
 * 逐像素多读 this.rows / this.cols 两个 embind getter，实测让 replaceMatOnRect
 * 慢 38%。数据见 typed-access.js 里 PTR() 上方的注释。
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

  /** 把 src1 的通道 0 拷进 this 由 rect 指定的矩形区域（就地）。 */
  cv.Mat.prototype.replaceMatOnRect = function replaceMatOnRect(src1, rect) {
    const where = "Mat.replaceMatOnRect(src, rect)";
    guards.mat(this, "接收者 Mat", where);
    guards.mat(src1, "src", where);
    guards.rect(this, rect, where);
    guards.covers(src1, rect, "src", where);
    const dstPtr = access.rawPtr(this);
    const srcPtr = access.rawPtr(src1);
    for (let i = 0; i < rect.height; i += 1) {
      for (let j = 0; j < rect.width; j += 1) {
        this[dstPtr](i + rect.y, j + rect.x)[0] = src1[srcPtr](i, j)[0];
      }
    }
  };

  /**
   * 用 arr 覆盖第 d 行（就地）。
   *
   * 1.x 硬编码 this.floatPtr(d)，非 CV_32F 的 Mat 直接抛异常；改用 PTR() 后
   * 7 种深度全部可用。
   */
  cv.Mat.prototype.replaceMatOnRow = function replaceMatOnRow(arr, d) {
    const where = "Mat.replaceMatOnRow(arr, row)";
    guards.mat(this, "接收者 Mat", where);
    guards.index(d, this.rows, "row", where);
    const row = this.PTR(d);
    guards.arrayLike(arr, row.length, "arr", where);
    for (let i = 0; i < row.length; i += 1) {
      row[i] = arr[i];
    }
  };

  /** 用 arr 覆盖第 d 列的通道 0（就地）。 */
  cv.Mat.prototype.replaceMatOnCol = function replaceMatOnCol(arr, d) {
    const where = "Mat.replaceMatOnCol(arr, col)";
    guards.mat(this, "接收者 Mat", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    guards.arrayLike(arr, rows, "arr", where);
    const ptr = access.rawPtr(this);
    for (let i = 0; i < rows; i += 1) {
      this[ptr](i, d)[0] = arr[i];
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
    guards.number(value, "value", where);

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
    this.PTR(row, column)[0] = value;
  };

  /** 给第 d 列的通道 0 逐行加上 constant（就地）。 */
  cv.Mat.prototype.addOnCol = function addOnCol(constant, d) {
    const where = "Mat.addOnCol(constant, col)";
    guards.mat(this, "接收者 Mat", where);
    guards.number(constant, "constant", where);
    guards.index(d, this.cols, "col", where);
    const rows = this.rows;
    const ptr = access.rawPtr(this);
    for (let i = 0; i < rows; i += 1) {
      this[ptr](i, d)[0] += constant;
    }
  };

  /** 把 src1 的通道 0 累加到 this 由 rect 指定的矩形区域（就地）。 */
  cv.Mat.prototype.rectAdd = function rectAdd(src1, rect) {
    const where = "Mat.rectAdd(src, rect)";
    guards.mat(this, "接收者 Mat", where);
    guards.mat(src1, "src", where);
    guards.rect(this, rect, where);
    guards.covers(src1, rect, "src", where);
    const dstPtr = access.rawPtr(this);
    const srcPtr = access.rawPtr(src1);
    for (let i = 0; i < rect.height; i += 1) {
      for (let j = 0; j < rect.width; j += 1) {
        this[dstPtr](rect.y + i, rect.x + j)[0] += src1[srcPtr](i, j)[0];
      }
    }
  };

  /** 把 src1 的通道 0 从 this 由 rect 指定的矩形区域中减去（就地）。 */
  cv.Mat.prototype.rectSubtract = function rectSubtract(src1, rect) {
    const where = "Mat.rectSubtract(src, rect)";
    guards.mat(this, "接收者 Mat", where);
    guards.mat(src1, "src", where);
    guards.rect(this, rect, where);
    guards.covers(src1, rect, "src", where);
    const dstPtr = access.rawPtr(this);
    const srcPtr = access.rawPtr(src1);
    for (let i = 0; i < rect.height; i += 1) {
      for (let j = 0; j < rect.width; j += 1) {
        this[dstPtr](rect.y + i, rect.x + j)[0] -= src1[srcPtr](i, j)[0];
      }
    }
  };
};
