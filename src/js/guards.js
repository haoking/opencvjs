"use strict";

/**
 * 参数前置校验 —— 把不可捕获的 wasm abort、以及更危险的静默越界写，
 * 转成可捕获的标准 TypeError / RangeError。
 *
 * 为什么需要这层（以下全部本机实测，2026-07-28，dist/ = OpenCV 4.14.0 wasm 产物）：
 *
 * 1. **abort 抛出的不是 Error 实例。** 本产物在异常被编译掉的配置下构建，C++ 侧
 *    `CV_Assert` 失败走 abort，emscripten 把它转成 `throw <裸数字>`：
 *      mat.roi(new cv.Rect(1, 1, 10, 10))   →  throw 1914504  （typeof "number"）
 *      cv.norm2(3×3 的 a, 3×4 的 b)          →  throw 1914528
 *    调用方 catch 到的是一个指针数值：`e.message` 是 undefined，`e instanceof Error`
 *    是 false，对它做任何字符串操作都会让调用方代码自己再崩一次，而且这个数字
 *    完全无法用来定位问题。（模块本身在 abort 之后仍可继续使用——实测 abort 后
 *    `cv.matFromArray` 一切正常，所以问题只在于「错误信息不可用」，不是「模块报废」。）
 *
 * 2. **更危险的一类根本不 abort。** embind 生成的 `*Ptr(row, col)` 不做任何边界检查：
 *      3×3 CV_32FC1（共 36 字节）上 `mat.PTR(9, 9)` 返回 base+144 字节处的
 *      Float32Array —— 读写都落在别的对象的堆上，不报任何错。
 *    `replaceMatOnRect` / `rectAdd` / `rectSubtract` / `replaceMatOnCol` / `addOnCol` /
 *    `replaceMatOnPoint` / `replaceMatOnRow` 全都由 `PTR()` 逐像素驱动，因此一个越界的
 *    Rect 或列号就是一次静默的堆破坏。这类错误比 (1) 危险得多，也正是 1.x 在
 *    `replaceMatOnRow` 上踩过的坑（见 README 的「2.0 修复」条目）。
 *
 * 3. **已被 delete() 的 Mat 反而是这几类里最轻的。** embind 自己就会抛
 *    `BindingError: Cannot pass deleted object as a pointer of type Mat const*`
 *    ——它是 Error 实例、消息可读。这里仍然校验，是为了补上 embind 说不出的那半句：
 *    是哪个函数的哪个参数。
 *
 * ⚠️ **每个下标只校验一次，绝不逐像素重复校验。** 实测单次调用成本
 * （node v22.22.2 / darwin-arm64，各 200 万次、取 3 轮最小值）：
 *
 *     mat.isDeleted()             2.1 ns      mat.rows（embind getter）   11.0 ns
 *     Number.isInteger ×2         2.6 ns      mat.rows + mat.cols         18.8 ns
 *     mat.floatPtr(r, c)         45.6 ns      mat.depth()                  5.7 ns
 *
 * 关键在于 `rows` / `cols` **是 embind getter，不是普通属性**——每读一次都是一次
 * 跨语言调用。所以职责这样分：
 *
 *   - `PTR()` 自己查边界（它是文档化的公开 API，用户会直接调）。代价是真实的：
 *     实测 +49%（+23.7 ns/次）。
 *   - 扩展层内部的逐像素循环**不走 PTR()**，而是在入口用 guards 一次性证明整个
 *     循环的下标范围合法，循环里直接用 typed-access 的 rawPtr() 取到的原生访问器。
 *     不这么做的话，`replaceMatOnRect` 实测慢 82%（同进程轮换 6 轮、丢首轮、取最小
 *     值），因为每个像素都要多付两次 embind getter。
 *
 * 入口校验本身很便宜：一次 roiClone 的校验合计约 26 ns，对照该函数本身约 700 ns
 * 不足 4%，性能门禁（npm run bench，20000 次 roiClone）实测无可测退化。
 */

/** 描述任意值，供错误消息使用。本身绝不抛出。 */
function describe(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "undefined") return "undefined";
  if (t === "string") return `string ${JSON.stringify(value.slice(0, 40))}`;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") {
    return `${t} ${String(value)}`;
  }
  if (t === "function") return `function ${value.name || "<匿名>"}`;
  try {
    const name = value.constructor && value.constructor.name;
    return name ? `${name} 实例` : "对象";
  } catch (_) {
    return "对象";
  }
}

module.exports = function applyGuards(cv) {
  // Mat 类型数值 → 名字 / 通道数。只用于错误消息与 matFromArray 的长度校验。
  // 不硬编码 CV_CN_SHIFT，全部从 cv 自己导出的常量反查；注意 cv.CV_8U === cv.CV_8UC1，
  // 因此 C1 先注册、裸深度常量自然落到同一条目上。
  const TYPE_NAME = new Map();
  const TYPE_CHANNELS = new Map();
  for (let channels = 1; channels <= 4; channels += 1) {
    for (const depth of ["8U", "8S", "16U", "16S", "32S", "32F", "64F"]) {
      const name = `CV_${depth}C${channels}`;
      const value = cv[name];
      if (typeof value !== "number") continue;
      if (!TYPE_NAME.has(value)) TYPE_NAME.set(value, name);
      if (!TYPE_CHANNELS.has(value)) TYPE_CHANNELS.set(value, channels);
    }
  }

  /** 类型数值 → "CV_32FC1(5)"，未知类型退回 "type=<数值>"。 */
  function typeName(type) {
    const name = TYPE_NAME.get(type);
    return name === undefined ? `type=${describe(type)}` : `${name}(${type})`;
  }

  const guards = {
    /** 必须是一个尚未 delete() 的 cv.Mat。 */
    mat(value, label, where) {
      if (!(value instanceof cv.Mat)) {
        throw new TypeError(
          `${where}: ${label} 必须是 cv.Mat，实际收到 ${describe(value)}`,
        );
      }
      if (value.isDeleted()) {
        throw new TypeError(
          `${where}: ${label} 已被 delete() —— 释放后的 Mat 不能再使用`,
        );
      }
      return value;
    },

    /** 必须是有限数（拒绝 NaN / ±Infinity / 非 number）。 */
    number(value, label, where) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(
          `${where}: ${label} 必须是有限数，实际收到 ${describe(value)}`,
        );
      }
      return value;
    },

    /** 必须是整数（不校验范围）。 */
    integer(value, label, where) {
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${where}: ${label} 必须是整数，实际收到 ${describe(value)}`,
        );
      }
      return value;
    },

    /**
     * 行 / 列下标：整数且落在 [0, limit)。
     *
     * 非整数必须拦下——embind 会把 1.5 静默截断成 1（实测
     * `3×3 的 mat.floatPtr(1.5, 0)` 返回第 1 行的值），产出的是错误结果而不是错误。
     */
    index(value, limit, label, where) {
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${where}: ${label} 必须是整数，实际收到 ${describe(value)}`,
        );
      }
      if (limit <= 0) {
        throw new RangeError(
          `${where}: ${label} = ${value} 越界 —— 该 Mat 在这个方向上是空的（长度 0）`,
        );
      }
      if (value < 0 || value >= limit) {
        throw new RangeError(
          `${where}: ${label} = ${value} 越界，有效范围 0..${limit - 1}`,
        );
      }
      return value;
    },

    /**
     * Rect 必须形状完整，且完全落在 mat 内。
     *
     * 判据与 OpenCV `Mat::Mat(const Mat&, const Rect&)` 里的 CV_Assert 逐条对应：
     *   0 <= x, 0 <= width, x + width <= cols, 0 <= y, 0 <= height, y + height <= rows
     * 那条断言在本产物里失败即 abort（抛裸数字）。
     */
    rect(mat, rect, where) {
      if (rect === null || typeof rect !== "object") {
        throw new TypeError(
          `${where}: rect 必须是 cv.Rect 或 {x, y, width, height}，实际收到 ${describe(rect)}`,
        );
      }
      const { x, y, width, height } = rect;
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(width) ||
        !Number.isInteger(height)
      ) {
        throw new TypeError(
          `${where}: rect 的四个字段必须都是整数，实际收到 ` +
            `{x: ${describe(x)}, y: ${describe(y)}, width: ${describe(width)}, height: ${describe(height)}}`,
        );
      }
      const rows = mat.rows;
      const cols = mat.cols;
      if (
        x < 0 ||
        y < 0 ||
        width < 0 ||
        height < 0 ||
        x + width > cols ||
        y + height > rows
      ) {
        throw new RangeError(
          `${where}: Rect(x=${x}, y=${y}, width=${width}, height=${height}) 超出 ` +
            `${rows}×${cols}（行×列）的 Mat —— 要求 0 ≤ x 且 x+width ≤ cols=${cols}，` +
            `0 ≤ y 且 y+height ≤ rows=${rows}`,
        );
      }
      return rect;
    },

    /** src 至少要覆盖 rect 指定的区域（否则循环里会读到 src 之外的堆内存）。 */
    covers(src, rect, label, where) {
      if (src.rows < rect.height || src.cols < rect.width) {
        throw new RangeError(
          `${where}: ${label} 是 ${src.rows}×${src.cols}（行×列），` +
            `装不下 ${rect.height}×${rect.width} 的区域 Rect(x=${rect.x}, y=${rect.y}, ` +
            `width=${rect.width}, height=${rect.height})`,
        );
      }
      return src;
    },

    /**
     * 对角线下标：OpenCV 的 `Mat::diag(d)` 取 d ≥ 0 时长度 min(cols−d, rows)、
     * d < 0 时 min(rows+d, cols)，并用 `CV_DbgAssert(len > 0)` 要求长度为正 ——
     * 而 DbgAssert 在 release 构建里是空操作，于是越界不报错：实测 3×3 上
     * `diag(4)` 返回一个 rows 为 **−1** 的畸形 Mat，`diag(9)` 则直接 abort。
     */
    diagIndex(mat, d, where) {
      if (!Number.isInteger(d)) {
        throw new TypeError(`${where}: d 必须是整数，实际收到 ${describe(d)}`);
      }
      const rows = mat.rows;
      const cols = mat.cols;
      if (rows <= 0 || cols <= 0) {
        throw new RangeError(`${where}: 空 Mat（${rows}×${cols}）上没有对角线`);
      }
      if (d <= -rows || d >= cols) {
        throw new RangeError(
          `${where}: d = ${d} 越界 —— ${rows}×${cols}（行×列）的 Mat 上有效范围是 ` +
            `${-(rows - 1)}..${cols - 1}（对角线长度必须 > 0）`,
        );
      }
      return d;
    },

    /** 必须是长度至少为 need 的类数组。 */
    arrayLike(value, need, label, where) {
      if (
        value === null ||
        typeof value !== "object" ||
        typeof value.length !== "number"
      ) {
        throw new TypeError(
          `${where}: ${label} 必须是数组或 TypedArray，实际收到 ${describe(value)}`,
        );
      }
      if (value.length < need) {
        throw new RangeError(
          `${where}: ${label} 只有 ${value.length} 个元素，需要 ${need} 个 —— ` +
            `不足的部分会被写成 undefined（浮点 Mat 上是 NaN，整型 Mat 上是 0）`,
        );
      }
      return value;
    },

    /**
     * 两个 Mat 的尺寸与类型必须一致。
     *
     * `cv.subtract` 在尺寸或类型不一致时 abort（抛裸数字）——`cv.norm2` 就建立在它上面。
     */
    sameSizeAndType(a, b, labelA, labelB, where) {
      if (a.rows !== b.rows || a.cols !== b.cols) {
        throw new RangeError(
          `${where}: ${labelA} 是 ${a.rows}×${a.cols}，${labelB} 是 ${b.rows}×${b.cols}` +
            `（行×列）—— 两者尺寸必须一致`,
        );
      }
      const ta = a.type();
      const tb = b.type();
      if (ta !== tb) {
        throw new TypeError(
          `${where}: ${labelA} 是 ${typeName(ta)}，${labelB} 是 ${typeName(tb)}` +
            ` —— 两者类型必须一致`,
        );
      }
    },

    /** Mat 的通道数必须在 allowed 之内。 */
    channels(mat, allowed, where) {
      const got = mat.channels();
      if (!allowed.includes(got)) {
        throw new TypeError(
          `${where}: 不支持 ${typeName(mat.type())} —— 该操作只接受 ` +
            `${allowed.join(" / ")} 通道的 Mat，实际收到 ${got} 通道`,
        );
      }
      return got;
    },
  };

  // ---------------------------------------------------------------------------
  // cv.matFromArray：元素不足时静默产出未初始化的堆内存
  //
  // glue 里的实现是 `new cv.Mat(rows, cols, type)` 后 `mat.dataXX.set(array)`。
  // TypedArray.set() 在源比目标**长**时抛 RangeError，短时却什么都不说 ——
  // 实测 `cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3])` 返回的 Mat 后 6 个元素
  // 是随机堆内容（如 1.57e-43、6.84e-43…）。这是本层最容易踩、也最难看出来的一处。
  //
  // 只加校验、不改任何合法输入的行为：长度对得上就原样转交 glue 的实现。
  // 类型不在已知表里（例如调用方自己算出的 >4 通道类型）时同样原样转交，由 glue
  // 自己的 `default: throw new Error("Type is unsupported")` 处理，不新增失败模式。
  // ---------------------------------------------------------------------------
  // 只包一次。cv 是 require 缓存里的同一个 Module 对象，而 loadOpenCV() 是可以被
  // 调用多次的（两个模块各写一句 `await require("@haoking/opencvjs")()` 就够了）。
  // 其余扩展都是「赋值到 prototype」因而天然幂等，只有这里是包裹，会一层层叠上去。
  const nativeMatFromArray = cv.matFromArray;
  if (typeof nativeMatFromArray === "function" && !nativeMatFromArray.guarded) {
    cv.matFromArray = function matFromArray(rows, cols, type, array) {
      const where = "cv.matFromArray(rows, cols, type, array)";
      const channels = TYPE_CHANNELS.get(type);
      if (
        channels !== undefined &&
        Number.isInteger(rows) &&
        Number.isInteger(cols) &&
        rows >= 0 &&
        cols >= 0
      ) {
        if (
          array === null ||
          typeof array !== "object" ||
          typeof array.length !== "number"
        ) {
          throw new TypeError(
            `${where}: array 必须是数组或 TypedArray，实际收到 ${describe(array)}`,
          );
        }
        const need = rows * cols * channels;
        if (array.length !== need) {
          throw new RangeError(
            `${where}: ${typeName(type)} 的 ${rows}×${cols} Mat 需要 ` +
              `${need} 个元素（${rows}×${cols}×${channels} 通道），实际收到 ${array.length} 个 —— ` +
              `元素不足时 TypedArray.set() 不报错，Mat 剩余部分是未初始化的堆内存`,
          );
        }
      }
      return nativeMatFromArray.call(this, rows, cols, type, array);
    };
    cv.matFromArray.guarded = true;
  }

  return guards;
};
