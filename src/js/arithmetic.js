"use strict";

/**
 * 标量算术、求和、按行数重排，以及 norm2。
 *
 * 这里留下的都是 OpenCV.js 没有等价物、或语义不同的：
 *  - addConstant / constantSubtract / mulConstant / constantDivide
 *    是 addWeighted / divide 的固定参数快捷方式
 *  - sum() 返回所有元素的标量和，与 cv.sum()（返回逐通道 Scalar）语义不同
 *  - reshapeRows() 产出的是副本，与 OpenCV 原生 reshape()（返回共享内存的
 *    新 header）语义不同
 *  - norm2() 是 ‖src1 − src2‖₂；见下方注释，这个产物里没有原生的双 Mat norm
 */

module.exports = function applyArithmetic(cv, guards) {
  /**
   * 四个标量运算的入口校验是同一组：接收者必须是活着的 Mat，常数必须是有限数。
   *
   * 常数一项不是形式主义：`addWeighted` 会把 undefined / NaN 一路算进去，实测
   * `mat.addConstant(undefined)` 返回一整个 NaN 的 Mat，不报任何错。整型 Mat 上
   * 更隐蔽 —— NaN 被截断成 0。
   */
  function checkScalarOp(mat, constant, where) {
    guards.mat(mat, "接收者 Mat", where);
    guards.number(constant, "constant", where);
  }

  /** 逐元素加常数，返回新 Mat。 */
  cv.Mat.prototype.addConstant = function addConstant(constant) {
    checkScalarOp(this, constant, "Mat.addConstant(constant)");
    const dst = new cv.Mat();
    cv.addWeighted(this, 1, this, 0, constant, dst);
    return dst;
  };

  /** 逐元素求 constant − x，返回新 Mat。 */
  cv.Mat.prototype.constantSubtract = function constantSubtract(constant) {
    checkScalarOp(this, constant, "Mat.constantSubtract(constant)");
    const dst = new cv.Mat();
    cv.addWeighted(this, -1, this, 0, constant, dst);
    return dst;
  };

  /** 逐元素乘常数，返回新 Mat。 */
  cv.Mat.prototype.mulConstant = function mulConstant(constant) {
    checkScalarOp(this, constant, "Mat.mulConstant(constant)");
    const dst = new cv.Mat();
    cv.addWeighted(this, constant, this, 0, 0, dst);
    return dst;
  };

  /**
   * 逐元素求 constant / x，返回新 Mat。全部 1–4 通道均正确。
   *
   * 被除数必须四个分量都填 constant。1.x 写的是 new cv.Scalar(constant)，而
   * Scalar 的缺省分量是 0，所以多通道时只有通道 0 拿到 constant，其余通道被
   * 0 除（实测 CV_32FC3 的填充结果是 7,0,0,7,0,0）。2.0 修掉。
   *
   * 不用 cv.Scalar.all(constant)：它在 opencv.js 的 glue 里是
   *   cv.Scalar.all = function (v) { return Scalar(v, v, v, v); };
   * —— 漏了 new，Scalar 构造函数体里的 this.push 因而打在 undefined 上，调用
   * 即抛 TypeError: this.push is not a function。这是 glue 自带的 JS 辅助函数
   * 的缺陷（Scalar 不是 embind 绑定，与白名单无关），任何产物上都一样。
   */
  cv.Mat.prototype.constantDivide = function constantDivide(constant) {
    checkScalarOp(this, constant, "Mat.constantDivide(constant)");
    const dst = new cv.Mat(
      this.rows,
      this.cols,
      this.type(),
      new cv.Scalar(constant, constant, constant, constant),
    );
    cv.divide(dst, this, dst);
    return dst;
  };

  /**
   * 所有元素（含各通道）的标量和。
   *
   * 与 cv.sum() 不同：后者返回逐通道的 Scalar（且本产物未导出它）。1.x 走的是
   * 当年为实现 svd 而内联进产物的 numeric 库的求和函数；那个库已随 svd 一起
   * 删除，这里改为纯 JS 累加，行为不变。
   */
  cv.Mat.prototype.sum = function sum() {
    guards.mat(this, "接收者 Mat", "Mat.sum()");
    const data = this.DATA();
    let total = 0;
    for (let i = 0; i < data.length; i += 1) {
      total += data[i];
    }
    return total;
  };

  /**
   * 按给定行数重排元素，返回**新 Mat**（副本）。
   *
   * 1.x 里这个方法叫 reshape(rows)，直接盖在 Mat.prototype 上。2.0 改名，
   * 原因有二：一是不覆盖原生方法（当前 wasm 产物的 embind 绑定里没有
   * Mat::reshape，但白名单一旦放开就会撞名）；二是语义本就不同 —— 原生
   * reshape() 返回共享内存的新 header，这里返回的是副本。
   */
  cv.Mat.prototype.reshapeRows = function reshapeRows(rows) {
    guards.mat(this, "接收者 Mat", "Mat.reshapeRows(rows)");
    const total = this.rows * this.cols;
    if (!Number.isInteger(rows) || rows <= 0 || total % rows !== 0) {
      throw new RangeError(
        `reshapeRows(${rows})：${this.rows}×${this.cols} 的 ${total} 个像素无法整除为 ${rows} 行`,
      );
    }
    return cv.matFromArray(rows, total / rows, this.type(), this.DATA());
  };

  /**
   * ‖src1 − src2‖ —— 两个 Mat 之差的范数。
   *
   * OpenCV C++ 有 norm(src1, src2, normType, mask) 重载，但**这个 wasm 产物
   * 的 embind 绑定里没有**：embind 只按参数个数分发，而 norm 的两组重载在
   * 2 参和 3 参上撞车，生成器只保留了 norm(src, normType, mask) 一组。实测：
   *   cv.norm(a, b)            → C++ 断言失败（Mat 被当成 normType 整数）
   *   cv.norm(a, b, NORM_L2)   → TypeError: Cannot pass "4" as a Mat
   *   cv.norm(a, b, NORM_L2, m)→ 参数个数无效
   * 第一种最危险：不报类型错，而是把 Mat 指针当整数 normType 传进去。
   * 因此这个 helper 保留，不能按“改用原生 cv.norm(a, b, normType)”迁移。
   */
  cv.norm2 = function norm2(src1, src2, normType = cv.NORM_L2) {
    // cv.subtract 在尺寸或类型不一致时 abort，抛出的是裸数字（实测 3×3 减 3×4
    // 得 `throw 1914528`）—— 这两条校验就是把那个数字换成一句话。
    const where = "cv.norm2(src1, src2, normType)";
    guards.mat(src1, "src1", where);
    guards.mat(src2, "src2", where);
    guards.sameSizeAndType(src1, src2, "src1", "src2", where);
    guards.integer(normType, "normType", where);

    const diff = new cv.Mat();
    try {
      cv.subtract(src1, src2, diff);
      return cv.norm(diff, normType);
    } finally {
      diff.delete();
    }
  };
};
