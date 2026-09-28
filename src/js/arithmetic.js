"use strict";

/**
 * 标量算术、求和、按行数重排，以及 norm2。
 *
 * 这里留下的都是 OpenCV.js 没有等价物、或语义不同的：
 *  - addConstant / constantSubtract / mulConstant / constantDivide
 *    是 convertTo / divide 的固定参数快捷方式
 *  - sum() 返回所有元素的标量和，与 cv.sum()（返回逐通道 Scalar）语义不同
 *  - reshapeRows() 产出的是副本，与 OpenCV 原生 reshape()（返回共享内存的
 *    新 header）语义不同
 *  - norm2() 是 ‖src1 − src2‖，normType 与 C++ 的 cv::norm(src1, src2, normType)
 *    同义；见下方注释，这个产物里没有原生的双 Mat norm
 */

module.exports = function applyArithmetic(cv, guards) {
  /**
   * 四个标量运算的入口校验是同一组：接收者必须是活着的 Mat，常数必须是数
   * （NaN 除外；±Infinity 放行，理由见 guards.number）。
   *
   * 常数一项不是形式主义：convertTo / divide 会把 undefined / NaN 一路算进去，实测
   * `mat.addConstant(undefined)` 返回一整个 NaN 的 Mat，不报任何错。整型 Mat 上
   * 更隐蔽 —— NaN 被截断成 0。
   */
  function checkScalarOp(mat, constant, where) {
    guards.mat(mat, "接收者 Mat", where);
    guards.number(constant, "constant", where);
  }

  /**
   * 下面三个都是 convertTo(dst, -1, alpha, beta)，即逐元素 saturate(x·alpha + beta)。
   *
   * 这里曾经写的是 addWeighted(this, alpha, this, 0, beta, dst)。多出来的那一项
   * this·0 在数据含 ±Infinity 时是 NaN（Infinity × 0），于是代价图 / 距离图上的
   * Infinity 哨兵加个常数就变成了 NaN（实测 [Inf, -Inf, 2] 加 1 得 NaN, NaN, 3）。
   * convertTo 没有这一项，也只读一遍源；对有限数据两者在 baseline 变体上逐位相同
   * （7 深度 × 1–4 通道 × 17 个常数实测）。
   */
  function affine(mat, alpha, beta) {
    const dst = new cv.Mat();
    mat.convertTo(dst, -1, alpha, beta);
    return dst;
  }

  /** 逐元素加常数，返回新 Mat。 */
  cv.Mat.prototype.addConstant = function addConstant(constant) {
    checkScalarOp(this, constant, "Mat.addConstant(constant)");
    return affine(this, 1, constant);
  };

  /** 逐元素求 constant − x，返回新 Mat。 */
  cv.Mat.prototype.constantSubtract = function constantSubtract(constant) {
    checkScalarOp(this, constant, "Mat.constantSubtract(constant)");
    return affine(this, -1, constant);
  };

  /** 逐元素乘常数，返回新 Mat。 */
  cv.Mat.prototype.mulConstant = function mulConstant(constant) {
    checkScalarOp(this, constant, "Mat.mulConstant(constant)");
    return affine(this, constant, 0);
  };

  /**
   * 逐元素求 constant / x，返回新 Mat。全部 1–4 通道均正确。
   *
   * 算法是 divide(全 1 的 Mat, this, dst, scale = constant)，即 saturate(constant / x)。
   * 常数走 scale 参数，不填进 Mat：填进去就得先按接收者的 depth 饱和——8U 上 1000
   * 会先被截成 255（于是 1000 / 10 得 26 而不是 100），5.4 会先被舍成 5。整型除以 0
   * 得 0 仍由 OpenCV 自己的除法内核保证。常数本就落在 depth 范围内时，这样算与
   * 原来的「填 constant、scale 取 1」逐位相同（7 深度 × 1–4 通道、含除数为 0，
   * 两个变体各 244 组实测）。
   *
   * 被除数的四个分量都必须填满。1.x 写的是 new cv.Scalar(constant)，而 Scalar 的
   * 缺省分量是 0，所以多通道时只有通道 0 拿到值，其余通道被 0 除（实测 CV_32FC3
   * 的填充结果是 7,0,0,7,0,0）。2.0 修掉。同理也不能用 cv.Mat.ones()：它在多通道
   * 上同样只把通道 0 置 1（实测 CV_32FC3 得 1,0,0,1,0,0）。
   *
   * 不用 cv.Scalar.all(1)：它在 opencv.js 的 glue 里是
   *   cv.Scalar.all = function (v) { return Scalar(v, v, v, v); };
   * —— 漏了 new，Scalar 构造函数体里的 this.push 因而打在 undefined 上，调用
   * 即抛 TypeError: this.push is not a function。这是 glue 自带的 JS 辅助函数
   * 的缺陷（Scalar 不是 embind 绑定，与白名单无关），任何产物上都一样。
   */
  cv.Mat.prototype.constantDivide = function constantDivide(constant) {
    const where = "Mat.constantDivide(constant)";
    checkScalarOp(this, constant, where);
    // Scalar 只有 4 个分量，>4 通道的 Mat 填不满，C++ 侧 abort 抛裸数字。
    guards.channels(this, [1, 2, 3, 4], where);
    const dst = new cv.Mat(
      this.rows,
      this.cols,
      this.type(),
      new cv.Scalar(1, 1, 1, 1),
    );
    cv.divide(dst, this, dst, constant);
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
    // DATA() 按连续内存直读，原生 roi() / col() / diag() 返回的视图上会读到视图之外
    // 的元素（实测 3×3 上 Rect(1,1,2,2) 的视图得 26，应为 28）。非连续时先拷一份
    // 连续副本再累加；单行视图的 isContinuous() 为 true，DATA() 在它上面本就是对的。
    if (!this.isContinuous()) {
      const copy = this.clone();
      try {
        return copy.sum();
      } finally {
        copy.delete();
      }
    }
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
    const where = "Mat.reshapeRows(rows)";
    guards.mat(this, "接收者 Mat", where);
    // 与其余扩展方法一致：不是整数是 TypeError，值不合法才是 RangeError。
    guards.integer(rows, "rows", where);
    const total = this.rows * this.cols;
    if (rows <= 0 || total % rows !== 0) {
      throw new RangeError(
        `${where}: ${this.rows}×${this.cols} 的 ${total} 个像素无法整除为 ${rows} 行`,
      );
    }
    // 与 sum() 同理：DATA() 在非连续视图上读到的不是视图里的元素，先拷连续副本。
    if (!this.isContinuous()) {
      const copy = this.clone();
      try {
        return copy.reshapeRows(rows);
      } finally {
        copy.delete();
      }
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
   *   cv.norm(a, b, NORM_L2)   → BindingError: Cannot pass "4" as a Mat
   *   cv.norm(a, b, NORM_L2, m)→ 参数个数无效
   * 第一种最危险：不报类型错，而是把 Mat 指针当整数 normType 传进去。
   * 因此这个 helper 保留，不能按“改用原生 cv.norm(a, b, normType)”迁移。
   */
  // 整型 depth 上 cv.subtract 按 depth 饱和：8U 的 0 − 10 得 0 而不是 −10，于是
  // norm2([0], [10]) 是 0、交换参数才是 10；8S 的 −128 − 127 也被截成 −128。
  // 这四种范数只取决于差值本身，差值改在 CV_64F 里算——整型之差在双精度里是精确的。
  // 浮点 depth 不受饱和影响，维持原来的算法，结果逐位不变。
  const INTEGER_DEPTHS = new Set([
    cv.CV_8U,
    cv.CV_8S,
    cv.CV_16U,
    cv.CV_16S,
    cv.CV_32S,
  ]);
  const DIFF_NORMS = new Set([
    cv.NORM_INF,
    cv.NORM_L1,
    cv.NORM_L2,
    cv.NORM_L2SQR,
  ]);
  // HAMMING 数的是 src1 XOR src2 里不同的位（C++ 只对 CV_8UC1 定义），不是差值的位：
  // 8U 上 1 − 2 饱和成 0，异或却是 0b11。
  const HAMMING_NORMS = new Set([cv.NORM_HAMMING, cv.NORM_HAMMING2]);

  cv.norm2 = function norm2(src1, src2, normType = cv.NORM_L2) {
    // cv.subtract 在尺寸或类型不一致时 abort，抛出的是裸数字（实测 3×3 减 3×4
    // 得 `throw <某个堆指针>`，具体数值每次调用、每个变体都不同，故不写死）
    // —— 这两条校验就是把那个数字换成一句话。
    const where = "cv.norm2(src1, src2, normType)";
    guards.mat(src1, "src1", where);
    guards.mat(src2, "src2", where);
    guards.sameSizeAndType(src1, src2, "src1", "src2", where);
    guards.integer(normType, "normType", where);

    // normType 只认 C++ 的 norm(src1, src2, normType) 认的那几种，可再按位或上
    // NORM_RELATIVE。此前只查「是整数」：非法值（例如 3）一路传进 cv.norm，在 C++
    // 断言处 abort、抛裸数字；NORM_RELATIVE 这一位则被静默丢掉，返回的是绝对范数。
    const base = normType & ~cv.NORM_RELATIVE;
    if (!DIFF_NORMS.has(base) && !HAMMING_NORMS.has(base)) {
      throw new RangeError(
        `${where}: normType = ${normType} 不是可用的范数类型 —— 只接受 NORM_INF / ` +
          `NORM_L1 / NORM_L2 / NORM_L2SQR / NORM_HAMMING / NORM_HAMMING2，` +
          `可再按位或上 NORM_RELATIVE`,
      );
    }
    if (HAMMING_NORMS.has(base)) {
      guards.type(src1, [cv.CV_8UC1], "NORM_HAMMING / NORM_HAMMING2 ", where);
    }
    // 与 C++ 同义：norm(src1 − src2, t) / (norm(src2, t) + DBL_EPSILON)。
    if (base !== normType) {
      return norm2(src1, src2, base) / (cv.norm(src2, base) + Number.EPSILON);
    }

    const exact = INTEGER_DEPTHS.has(src1.depth()) && DIFF_NORMS.has(base);
    const diff = new cv.Mat();
    const noMask = exact ? new cv.Mat() : null;
    try {
      if (HAMMING_NORMS.has(base)) {
        cv.bitwise_xor(src1, src2, diff);
      } else if (exact) {
        cv.subtract(src1, src2, diff, noMask, cv.CV_64F);
      } else {
        cv.subtract(src1, src2, diff);
      }
      return cv.norm(diff, base);
    } finally {
      diff.delete();
      if (noMask) noMask.delete();
    }
  };
};
