# 从 1.x 迁移到 2.0

2.0 换掉了产物（2018 年的 asm.js / OpenCV 4.0.1 → 自建 WebAssembly / OpenCV 4.14.0），
并把手写扩展层从「补丁进单文件产物」重写成随包发布的独立模块。

破坏性变更集中在三处：

1. **加载方式**：包入口返回 Promise，必须 `await`。
2. **不再覆盖 OpenCV 原生方法**：`roi` / `col` / `diag` / `reshape` 归还原生，
   本项目的修复版改名为 `roiClone` / `colClone` / `diagClone` / `reshapeRows`。
3. **12 个手写方法删除**，改用产物里的原生等价函数（1.x 的手写版有几个本来就是坏的）。

下面每一条都给出改法。本文里所有输出值都是在 2.0 的产物上实际跑出来的。

---

## 1. 加载方式

**1.x**（同步，`require` 直接拿到 `cv`）：

```javascript
const cv = require("@haoking/opencvjs");
const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
```

**2.0**（入口是个 async 函数，返回 Promise）：

```javascript
const loadCV = require("@haoking/opencvjs");

(async () => {
  const cv = await loadCV();
  const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  console.log("mat::" + mat.data32F); //mat::1,2,3,4,5,6,7,8,9
  mat.delete();
})();
```

> ⚠️ **判断就绪只能看 `typeof cv.Mat === "function"`。**
> `await` 之后 `cv.onRuntimeInitialized` 这个属性**依然存在**（实测 `typeof` 为
> `function`）。拿它当「还没就绪」的判据会恒真，于是去 `await` 一个永不再触发的
> 回调——本项目第一次 CI 冒烟测试就是这么挂掉的。

浏览器：2.0 的产物是 `opencv.js`（约 143 KB 的 glue）+ `opencv_js.wasm`（约 8.5 MB），
不再是「一个 .js 文件」。扩展层是 CommonJS 模块，浏览器里要用得走打包器。详见
README 的 Installation 一节。

---

## 2. 改名：不再覆盖原生方法

1.x 把修复直接盖在 OpenCV 原生的 `roi()` / `col()` / `diag()` 上，代价是原生的
**视图语义**被静默改掉：`mat.roi(rect).setTo(...)` 不再写回源 Mat，且不报任何错。
2.0 不动原生方法，修复版换独立名字。

| 1.x                 | 2.0                     | 说明                                 |
| ------------------- | ----------------------- | ------------------------------------ |
| `mat.roi(rect)`     | `mat.roiClone(rect)`    | 返回独立副本，连续，`.data*` 可直读  |
| `mat.col(d)`        | `mat.colClone(d)`       | 同上                                 |
| `mat.Diag(d)`       | `mat.diagClone(d)`      | 同上（注意 1.x 是大写 `D`）          |
| `mat._roi(rect)`    | `mat.roi(rect)`         | 1.x 的转义名取消——原生方法已不被覆盖 |
| `mat._col(d)`       | `mat.col(d)`            | 同上                                 |
| `mat.reshape(rows)` | `mat.reshapeRows(rows)` | 见下方说明                           |

选哪个：**要读数据用 `*Clone`，要写回源 Mat 用原生方法。**

```javascript
// 读：必须用副本。原生视图非连续，.data* 会按连续内存直读，得到错的数据
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
console.log("col::" + m.col(2).data32F); //col::3,4,5        ← 错的（视图非连续）
console.log("colClone::" + m.colClone(2).data32F); //colClone::3,6,9   ← 对的

// 写：必须用原生视图，副本写了不会回到源 Mat
const view = m.roi(new cv.Rect(1, 1, 2, 2));
view.setTo(new cv.Scalar(0, 0, 0, 0));
console.log("m::" + m.data32F); //m::1,2,3,4,0,0,7,0,0
```

多通道上差别更大（3×3 `CV_32FC2`，值 1..18）：

```javascript
// prettier-ignore
const m2 = cv.matFromArray(3, 3, cv.CV_32FC2,
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
console.log("col::" + m2.col(2).data32F); //col::5,6,7,8,9,10        ← 错的
console.log("colClone::" + m2.colClone(2).data32F); //colClone::5,6,11,12,17,18   ← 对的
```

**`reshape` 的改名理由与上面几个不同**：这个产物的 embind 绑定里**根本没有**
`Mat::reshape`（`typeof cv.Mat.prototype.reshape === "undefined"`），1.x 并没有覆盖
任何东西。改名是为了腾出这个名字（白名单一旦放开就会撞名），顺带把语义差异摆明：
原生 `reshape()` 返回共享内存的新 header，`reshapeRows()` 返回的是**副本**。
2.0 还加了整除校验：

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const flat = m.reshapeRows(1); // 1×9
m.reshapeRows(4); // RangeError: reshapeRows(4)：3×3 的 9 个像素无法整除为 4 行
```

---

## 3. 删除：改用原生等价函数

这些方法 2.0 起不存在（`typeof` 为 `undefined`）。产物的白名单里已放行等价的原生
函数，行为经过实测比对。

### `mat.mmul(b)` → `cv.gemm`

```javascript
const a = cv.matFromArray(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]);
const b = cv.matFromArray(3, 2, cv.CV_32FC1, [7, 8, 9, 10, 11, 12]);
const noop = new cv.Mat(); // gemm 的 src3；beta=0 时不参与计算
const dst = new cv.Mat();
cv.gemm(a, b, 1, noop, 0, dst, 0);
console.log("dst::" + dst.data32F); //dst::58,64,139,154
```

### `mat.vconcat(b)` / `mat.hconcat(b)` → `cv.vconcat` / `cv.hconcat`

参数由 Mat 变成 MatVector：

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const vec = new cv.MatVector();
vec.push_back(m);
vec.push_back(m);

const v = new cv.Mat();
cv.vconcat(vec, v); // 6×3: 1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9

const h = new cv.Mat();
cv.hconcat(vec, h); // 3×6: 1,2,3,1,2,3,4,5,6,4,5,6,7,8,9,7,8,9
```

### `mat.mds()` → `cv.meanStdDev`

1.x 的 `mds()` **100% 抛异常**（`TypeError: src1Array.reduce is not a function`：
实现里写的是 `this.DATA` 而不是 `this.DATA()`，取到的是函数对象）。没有「以前能用」
这回事，所以这条迁移不会破坏任何真在运行的代码。

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const mean = new cv.Mat();
const stddev = new cv.Mat();
cv.meanStdDev(m, mean, stddev);
console.log(mean.data64F[0], stddev.data64F[0]); // 5 2.5819888974716108
```

### `mat.svd()` → `cv.SVDecomp`

1.x 走的是当年内联进产物的 numeric.js 库；2.0 删掉那份库，改用原生。

```javascript
const m = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const w = new cv.Mat();
const u = new cv.Mat();
const vt = new cv.Mat();
cv.SVDecomp(m, w, u, vt, 0);
console.log("w::" + w.data32F);
//w::16.848102569580078,1.0683696269989014,1.1560786106201704e-8
```

（奇异值与 1.x 的 numeric.svd 一致；第三个是 0——`[[1,2,3],[4,5,6],[7,8,9]]` 秩为 2。）

### `cv.RodriguesFromArray(arr)` / `mat.RodriguesFromMat()` → `cv.Rodrigues`

原生 `cv.Rodrigues(src, dst)` 双向都走同一个函数，按输入形状自动判断方向：

```javascript
const rvec = cv.matFromArray(3, 1, cv.CV_32FC1, [0.1, 0.2, 0.3]);
const R = new cv.Mat();
cv.Rodrigues(rvec, R); // 3×3 旋转矩阵

const back = new cv.Mat();
cv.Rodrigues(R, back);
console.log("back::" + back.data32F);
//back::0.10000000149011612,0.20000000298023224,0.30000004172325134
```

### `cv.mulSpectrums(a, b, conjB)` / `cv.mulSpectrums2Channel(...)` → 原生 `cv.mulSpectrums`

1.x 的两个手写版**都返回无效结果**：部分元素恒为 `NaN`，另一部分每次运行都不同
（读到了未初始化的堆内存）。2.0 把 `mulSpectrums` 加进了构建白名单，直接用原生的。

签名变为 `cv.mulSpectrums(a, b, dst, flags, conjB)`——多一个输出参数 `dst` 和一个
`flags`：

```javascript
// CCS 紧凑格式（cv.dft 不带 DFT_COMPLEX_OUTPUT 时的单通道输出）
const a = cv.matFromArray(1, 4, cv.CV_32FC1, [1, 2, 3, 4]);
const b = cv.matFromArray(1, 4, cv.CV_32FC1, [5, 6, 7, 8]);
const dst = new cv.Mat();
cv.mulSpectrums(a, b, dst, 0, false);
console.log("dst::" + dst.data32F); //dst::5,-9,32,32

// 双通道复数格式（取代 mulSpectrums2Channel）
const c1 = cv.matFromArray(1, 2, cv.CV_32FC2, [1, 2, 3, 4]); // 1+2i, 3+4i
const c2 = cv.matFromArray(1, 2, cv.CV_32FC2, [5, 6, 7, 8]); // 5+6i, 7+8i
const d2 = new cv.Mat();
cv.mulSpectrums(c1, c2, d2, 0, false);
console.log("d2::" + d2.data32F); //d2::-7,16,-11,52   ← (1+2i)(5+6i), (3+4i)(7+8i)
cv.mulSpectrums(c1, c2, d2, 0, true);
console.log("d2::" + d2.data32F); //d2::17,4,53,4      ← conjB
```

原生版返回的 `channels()` 与输入一致（1.x 的手写版对 `CV_32FC2` 输入返回
`channels() === 1`）。

---

## 4. 签名修正（名字没变，调用方可能要改）

### `mat.replaceMatOnPoint`

1.x 的形参名写作 `(constant, x, y)`，而实现是 `PTR(x, y)`——`x` 其实是**行号**、
`y` 是**列号**，与参数名给人的印象相反；README 里记的 `(value, point)` 重载则根本
不存在（传对象抛 `TypeError: Cannot convert "[object Object]" to int`）。

2.0 把两者对齐：

```javascript
const mat = cv.matFromArray(3, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

mat.replaceMatOnPoint(30, 1, 1); // (value, row, col)
console.log("mat::" + mat.data32F); //mat::1,2,3,4,30,6,7,8,9

mat.replaceMatOnPoint(99, new cv.Point(2, 0)); // (value, point)，cv.Point 约定 x=列、y=行
console.log("mat::" + mat.data32F); //mat::1,2,99,4,30,6,7,8,9

mat.replaceMatOnPoint(1, 0);
//TypeError: replaceMatOnPoint(value, row, col) 或 replaceMatOnPoint(value, point)：缺少 col
```

**位置参数的行为没变**：1.x 的实现是 `this.PTR(x, y)[0] = constant`（见旧产物
`opencv.js:250-252`），第 2 个参数一直是行、第 3 个一直是列，与 2.0 的
`PTR(row, col)` 逐字相同。变的只有形参名（不再误导）和新增的 `(value, point)` 重载。
所以**已经在跑的三参调用不用改**；要改的是当初照着文档写 `(value, point)` 而一直
在吃 `TypeError` 的那些调用点——它们现在能跑了。

### `mat.replaceMatOnRow`

1.x 硬编码 `this.floatPtr(d)`。README 旧版把这条记成「仅支持 CV_32F 类型」，实测
**并不是抛异常，而是静默写坏内存**：embind 的 `floatPtr` 不做类型校验，`CV_8UC1` 的
2×3 Mat（6 字节）上 `floatPtr(0)` 返回长度 3 的 `Float32Array`（12 字节），写入即
越界 6 字节且不报任何错。

2.0 改走类型分发的 `PTR()`，七种深度全部正确：

```javascript
// 2×3、值 1..6，把第 0 行换成 [10, 20, 30]
// 1.x: CV_8UC1 → 0,0,32,65,0,0 且越界写 6 字节；CV_32SC1 → 1092616192,1101004800,...
// 2.0: 七种深度一律 10,20,30,4,5,6
const mat = cv.matFromArray(2, 3, cv.CV_8UC1, [1, 2, 3, 4, 5, 6]);
mat.replaceMatOnRow([10, 20, 30], 0);
console.log("mat::" + mat.DATA()); //mat::10,20,30,4,5,6
```

### `mat.constantDivide`

名字与签名都没变，**行为修正**：1.x 填被除数用 `new cv.Scalar(constant)`，而 Scalar
的缺省分量是 0，多通道时通道 1+ 被 0 除（实测填 `CV_32FC3` 得 `16,0,0,16,0,0`）。
2.0 起 1–4 通道全部正确：

```javascript
const m = new cv.Mat(1, 2, cv.CV_32FC3, new cv.Scalar(2, 2, 2, 2));
console.log("dst::" + m.constantDivide(16).data32F); //dst::8,8,8,8,8,8
```

---

## 5. 没变的

- `DATA()` / `PTR()`：实现从 28 路 switch 改成按 `depth()` 查表，行为等价，且对
  OpenCV 允许的 >4 通道 Mat 也成立（旧实现在那里返回 `undefined`）。
  `PTR` 的形参名由 `(x, y)` 更正为 `(row, col)`——语义一直是行、列。
- `addConstant` / `constantSubtract` / `mulConstant` / `sum`
- `replaceMatOnRect` / `replaceMatOnCol` / `addOnCol` / `rectAdd` / `rectSubtract`
- `cv.norm2(a, b)`：**保留，不要改用原生 `cv.norm(a, b, normType)`**。embind 只按
  参数个数分发，而 C++ 的两组 `norm` 重载（`norm(src, normType, mask)` 与
  `norm(src1, src2, normType, mask)`）在 2 参和 3 参上撞车，绑定生成器只保留了前一组。
  实测 `cv.norm(a, b, cv.NORM_L2)` 抛 `Cannot pass "4" as a Mat`；更糟的是
  `cv.norm(a, b)` **不报类型错**，而是把 Mat 的 wire 指针当整数 `normType` 传进 C++，
  在 OpenCV 内部的断言处才炸。
- `mat.dftSplit()`：保留但已标 `@deprecated`。它的 CCS 展开约定从未被独立验证过，
  且 1.x 时代唯一的消费者（那个返回 NaN 的 `mulSpectrums`）本身就是坏的——不存在
  「它以前工作正常」这回事。需要复数谱相乘请直接用原生 `cv.mulSpectrums`，它在 CCS
  格式上直接做乘法，根本不需要先拆分。

---

## 6. 一并注意

- **`cv.sum` 不存在**（不在白名单里）。`mat.sum()` 是本项目的扩展方法，返回**所有
  元素（含各通道）的标量和**，与 OpenCV 的 `cv.sum()`（返回逐通道 Scalar）语义不同。
- **dnn 的 JS 绑定已裁掉**：`cv.readNetFromTensorflow` 等为 `undefined`。
  （dnn 的 C++ 代码仍在产物里——白名单只控制 embind 绑定生成。）
- **`cv.Scalar.all(v)` 不可用**：产物的 glue 里写的是
  `cv.Scalar.all = function (v) { return Scalar(v, v, v, v); }`——漏了 `new`，
  调用即抛 `TypeError: this.push is not a function`。这是 glue 自带 JS 辅助函数的
  缺陷（`Scalar` 不是 embind 绑定），任何 opencv.js 产物上都一样。用
  `new cv.Scalar(v, v, v, v)`。
- **`cv.SVD` 这个类不存在**，只有函数式的 `cv.SVDecomp`。
