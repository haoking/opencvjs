"use strict";

/**
 * 类型分发访问器：DATA() / PTR()
 *
 * OpenCV.js 的 embind 绑定按元素类型暴露不同的访问器（data / data8S / …；
 * ucharPtr / charPtr / …）。调用方要自己按 Mat 的深度挑对应的那一个，挑错
 * 会读到按错误字长重解释的字节，不报错、结果全错。DATA()/PTR() 把这层分发
 * 收进来，按 depth() 选。
 *
 * 旧实现写成 28 路 switch（7 深度 × 4 通道）。通道数不参与选择——CV_8UC1 与
 * CV_8UC4 用的是同一个 data 视图——所以这里按 depth() 查表，行为等价，且对
 * OpenCV 允许的 >4 通道 Mat 也成立（旧的 28 路 switch 在那里返回 undefined）。
 *
 * 除了两个方法，本模块还返回一个 { pixels } 供扩展层内部的逐像素写入使用——
 * 为什么需要它，见 PTR() 上方那段关于「校验放哪里」的实测与 pixels() 的说明。
 */

/**
 * 写进整型 Mat 时的饱和，与 OpenCV 的 saturate_cast 一致：四舍六入五成双（cvRound
 * 的舍入规则），再钳到该 depth 的取值范围；NaN 得 0。
 *
 * 直接赋给 Uint8Array 一类的视图是另一套规则——按模 2^n 回绕、小数截断（250 + 20
 * 写进 8U 得 14）。扩展层的就地写入方法以前就是这么写的，与同一个库里走 OpenCV 的
 * addConstant（得 255）互相矛盾。
 */
function saturator(lo, hi) {
  return (v) => {
    if (v >= hi) return hi;
    if (v <= lo) return lo;
    if (v !== v) return 0; // NaN
    const r = Math.round(v); // .5 一律向 +∞
    return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r; // 恰为 .5 且落在奇数上：取偶
  };
}

module.exports = function applyTypedAccess(cv, guards) {
  // OpenCV 的 depth 值 CV_8U..CV_64F 恒为 0..6，但仍从 cv 上取，避免硬编码。
  const DATA_BY_DEPTH = [];
  const PTR_BY_DEPTH = [];
  const TABLE = [
    [cv.CV_8U, "data", "ucharPtr"],
    [cv.CV_8S, "data8S", "charPtr"],
    [cv.CV_16U, "data16U", "ushortPtr"],
    [cv.CV_16S, "data16S", "shortPtr"],
    [cv.CV_32S, "data32S", "intPtr"],
    [cv.CV_32F, "data32F", "floatPtr"],
    [cv.CV_64F, "data64F", "doublePtr"],
  ];
  for (const [depth, dataProp, ptrMethod] of TABLE) {
    DATA_BY_DEPTH[depth] = dataProp;
    PTR_BY_DEPTH[depth] = ptrMethod;
  }

  // depth → 与之同型的 wasm 堆视图名、每元素字节数、写入时的饱和函数（浮点为 null）。
  const HEAP_BY_DEPTH = [];
  for (const [depth, heap, bytes, lo, hi] of [
    [cv.CV_8U, "HEAPU8", 1, 0, 255],
    [cv.CV_8S, "HEAP8", 1, -128, 127],
    [cv.CV_16U, "HEAPU16", 2, 0, 65535],
    [cv.CV_16S, "HEAP16", 2, -32768, 32767],
    [cv.CV_32S, "HEAP32", 4, -2147483648, 2147483647],
    [cv.CV_32F, "HEAPF32", 4],
    [cv.CV_64F, "HEAPF64", 8],
  ]) {
    HEAP_BY_DEPTH[depth] = {
      heap,
      bytes,
      saturate: lo === undefined ? null : saturator(lo, hi),
    };
  }

  /**
   * 返回覆盖整个 Mat 的 TypedArray（按元素类型定型）。
   *
   * 没有可越界的入参（不收参数），所以除了深度分发本身没有别的可校验的东西。
   *
   * ⚠️ 仅对连续 Mat 有意义。原生 roi()/col()/diag() 返回的非连续视图上，
   * 这个视图会按连续内存直读，得到错误数据 —— 见 mat-region.js 的 roiClone()。
   */
  cv.Mat.prototype.DATA = function DATA() {
    const prop = DATA_BY_DEPTH[this.depth()];
    if (prop === undefined) {
      throw new TypeError(`Mat.DATA(): 不支持的 Mat depth ${this.depth()}`);
    }
    return this[prop];
  };

  /**
   * PTR(row)      → 第 row 行的全部元素（cols × channels 个）
   * PTR(row, col) → (row, col) 处像素的各通道（channels 个）
   *
   * 行列下标都会校验。不校验的话，embind 生成的 `*Ptr` 什么都不查：3×3 CV_32FC1
   * （共 36 字节）上 `PTR(9, 9)` 返回 base+144 字节处的 Float32Array，读写都落在
   * 别人的堆上、不报任何错；小数下标则被静默截断（`PTR(1.5, 0)` 取第 1 行）。
   * PTR() 是文档化的公开 API，用户会直接调它，所以这层不能省。
   *
   * ⚠️ 校验要读 `this.rows` / `this.cols` 两个 **embind getter**，各约 11 ns ——
   * 它们是跨语言调用，不是普通属性读取。实测（同进程交替 6 轮、丢首轮、取最小值，
   * node v22.22.2 / darwin-arm64）：
   *     PTR(1, 1) 紧循环   96.2 → 143.6 ms / 200 万次   +49%（+23.7 ns/次）
   *     PTR(row) 行形式   101.4 → 132.6 ms / 200 万次   +31%（+15.6 ns/次）
   * 行形式后来为了截掉视图上越出本行的长度，又多读 cols / channels() 两次（见函数
   * 体），同法实测每次再增约 28 ns。也就是说这层校验**不便宜**。
   *
   * 所以扩展层内部那些逐像素的循环不走 PTR()：它们在入口用 guards 一次性证明整个
   * 循环的下标范围合法，循环里用下面的 pixels() 按地址直接读写 wasm 堆，连原生的
   * *Ptr() 也不调。退回逐像素调 PTR() 要慢上百倍，倍数以 `npm run bench` 的
   * inplace-ops 门禁每次打印的「退化参照」为准，不在注释里另抄一份。
   */
  cv.Mat.prototype.PTR = function PTR(row, col) {
    const where = "Mat.PTR(row, col)";
    const method = PTR_BY_DEPTH[this.depth()];
    if (method === undefined) {
      throw new TypeError(`${where}: 不支持的 Mat depth ${this.depth()}`);
    }
    guards.index(row, this.rows, "row", where);
    // 只给 row 就是「取整行」。1.x 到 2.0 这里的缺省值一直写作 -1、判据是
    // `col < 0`，于是 PTR(0, -1) 会被当成取整行而不是报错；改成 undefined 之后
    // 任何负数列号都会如实报越界。-1 这个哨兵从未出现在文档或调用方里。
    if (col === undefined) {
      // embind 的 *Ptr(row) 返回 step1(0) 个元素，那是**父 Mat** 的行跨度。原生
      // roi() / col() 返回的视图上它会越过本行，末行时越过整块缓冲区——实测 2×64
      // 父 Mat 的右下角 1×1 视图上多出 63 字节，经 replaceMatOnRow 写进去会改坏
      // 紧随其后分配的 Mat。单行视图的 isContinuous() 是 true 却同样中招，所以不看
      // 连续性，一律截到本行真实的 cols × channels 个；连续 Mat 上两者相等，原样返回。
      const view = this[method](row);
      const len = this.cols * this.channels();
      return view.length === len ? view : view.subarray(0, len);
    }
    guards.index(col, this.cols, "col", where);
    return this[method](row, col);
  };

  return {
    /**
     * 按地址直接读写 Mat 数据：返回与 depth 同型的 wasm 堆视图，以及按**元素**计的
     * 起点与跨度。
     *
     *   (r, c) 处通道 k 的下标 = base + r * rowStep + c * pixelStep + k
     *
     * 对原生 roi() / col() 的视图同样成立：base 取自视图自己的首元素地址
     * （data.byteOffset），rowStep 取自 step[0]，视图上那是父 Mat 的行跨度。
     *
     * 为什么不逐像素调 embind 的 *Ptr()：每调一次都要跨一次语言边界、再新建一个
     * TypedArray，比按地址直接写慢两个数量级（倍数以 npm run bench 的 inplace-ops
     * 门禁输出为准，不在这里另抄）。
     *
     * ⚠️ 这里**不查边界**：调用方必须先用 guards 证明整个循环的下标范围合法。
     * ⚠️ heap 是调用这一刻的堆视图。之后只要做过可能分配 wasm 内存的操作（例如
     *    clone），就得重新调用本函数：内存增长时 emscripten 会换一块新 buffer 并重新
     *    赋值 cv.HEAP*，之前取到的视图随之失效（长度变 0，写进去的东西直接丢掉）。
     *    byteOffset / rowBytes / pixelBytes 是同一组地址的字节版，供调用方判断两个 Mat
     *    的内存是否重叠，免得再各读一遍 embind getter。
     *
     *    （这里曾试过把 heap 做成 getter、延后到循环前再取：每次调用都要新建一个带
     *    访问器的对象，实测列操作从 0.31 µs 变成 0.49 µs，得不偿失。）
     *
     * where 由调用方传入：深度不支持时要报的是**调用方**的名字，而不是本函数。
     */
    pixels(mat, where) {
      const info = HEAP_BY_DEPTH[mat.depth()];
      if (info === undefined) {
        throw new TypeError(`${where}: 不支持的 Mat depth ${mat.depth()}`);
      }
      const byteOffset = mat.data.byteOffset;
      const rowBytes = mat.step[0];
      const pixelBytes = mat.elemSize();
      // OpenCV 的分配与视图起点都按元素对齐；这里只是防御，对不上就别按元素寻址。
      if (byteOffset % info.bytes !== 0 || rowBytes % info.bytes !== 0) {
        throw new Error(
          `${where}: Mat 的数据地址或行跨度没有按元素对齐，无法按元素寻址`,
        );
      }
      return {
        heap: cv[info.heap],
        base: byteOffset / info.bytes,
        rowStep: rowBytes / info.bytes,
        pixelStep: pixelBytes / info.bytes,
        saturate: info.saturate,
        byteOffset,
        rowBytes,
        pixelBytes,
      };
    },
  };
};
