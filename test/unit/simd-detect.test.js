"use strict";

// WebAssembly SIMD 探测与变体决策。
//
// ── false 分支怎么验 ──────────────────────────────────────────────────────
// 探测函数在支持 SIMD 的引擎上返回 true，这一条可以直接测（Node 22 就是）。
// 但「在不支持 SIMD 的引擎上返回 false」没法直接测——手边没有那样的引擎，
// 而这恰恰是探测最要紧的那一半：探测器若恒为 true，93.57% 覆盖率之外的
// 6.43% 浏览器会拿到一份跑不起来的 wasm。
//
// 所以改成把这件事拆成两条各自可证的断言：
//
//   ① WebAssembly.validate() 确实会校验函数体，不是只看魔数就返回 true。
//      —— 把 SIMD 操作码改坏，validate 必须返回 false。
//   ② 探测模块里的 SIMD 成分是承重的，不是装饰。
//      —— 把结果类型 v128(0x7b) 换成 i32(0x7f)，validate 必须返回 false；
//         而一个把 v128 与函数体一起换成标量的同构模块 validate 必须为 true。
//
// ①+② 合起来说明：这个模块的合法性完全押在引擎认不认识 SIMD 上。一个不认识
// SIMD 的引擎在 ① 的机制下只能返回 false。这是在没有反例引擎的前提下能拿到的
// 最强证据。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { DIST } = require("../helpers");

// 测组装后的那一份（和 helpers.js 的理由相同：用户拿到的是 dist/）。
const simd = require(path.join(DIST, "simd-detect.js"));

/** 复制一份探测模块并改掉一个字节。原数组不能动——它是生产用的那一份。 */
function mutated(index, value) {
  const bytes = simd.SIMD_PROBE.slice();
  bytes[index] = value;
  return bytes;
}

test("探测模块是 31 字节，头部是合法的 wasm 魔数与版本号", () => {
  assert.strictEqual(simd.SIMD_PROBE.length, 31);
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(0, 8)),
    [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    '前 8 字节应为 "\\0asm" + version 1',
  );
});

test("探测模块的函数返回 v128，函数体含两条 0xfd 前缀的 SIMD 指令", () => {
  // 类型段: 01 05 | 01 | 60 00 01 7b
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(8, 15)),
    [0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b],
    "类型段应声明 func () -> (v128)，0x7b 即 v128",
  );
  // 代码段体: 00 | 41 00 | fd 0f | fd 62 | 0b
  assert.deepStrictEqual(
    Array.from(simd.SIMD_PROBE.slice(23, 31)),
    [0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b],
    "函数体应为 i32.const 0 / i8x16.splat / i8x16.popcnt / end",
  );
});

test("probeSimd() 在支持 SIMD 的运行时返回 true", () => {
  // Node 18 起 WebAssembly SIMD 默认开启，本包 engines 要求 node >= 18，
  // 所以这条在所有受支持的 Node 上都该为 true。它若为 false，说明要么探测
  // 字节序列写错了，要么运行环境比声称的还老。
  assert.strictEqual(
    simd.probeSimd(),
    true,
    "本运行时应支持 WebAssembly SIMD（node >= 18）",
  );
});

test("WebAssembly.validate 确实校验函数体：改坏 SIMD 指令即为 false", () => {
  // 索引 29 是 i8x16.popcnt 的子操作码 0x62。
  assert.strictEqual(simd.SIMD_PROBE[29], 0x62);

  // 0xfe / 0xff：SIMD 子操作码是 LEB128 编码的 u32，最高位为 1 表示「后面还有
  // 字节」，而这里后面紧跟的是 0x0b(end)——编码在此截断，模块畸形。这条不依赖
  // 任何具体操作码的分配情况，将来新增指令也不会让它失效。
  for (const bad of [0xfe, 0xff]) {
    assert.strictEqual(
      WebAssembly.validate(mutated(29, bad)),
      false,
      `0xfd 0x${bad.toString(16)} 是截断的 LEB128，validate 应为 false`,
    );
  }

  // 0x0f：换成 i8x16.splat，它是合法指令，但签名是 i32 -> v128；此刻栈顶已经是
  // 前一条 splat 压上去的 v128，类型不符。这条证明的是 validate 真的在做**类型
  // 检查**，不只是认操作码。
  //
  // 刻意不用「随便挑一个未分配的操作码」来做这条断言：实测 256 个单字节子操作码
  // 里有 239 个在此上下文中无效，但那多半是因为操作数个数不对（多数 SIMD 指令
  // 要两个 v128，栈上只有一个），而不是因为操作码不存在——用它论证「validate
  // 会拒绝不认识的指令」是站不住的。
  assert.strictEqual(
    WebAssembly.validate(mutated(29, 0x0f)),
    false,
    "i8x16.splat 期望 i32 而栈顶是 v128，validate 应为 false",
  );
});

test("v128 是承重的：把结果类型换成 i32 后 validate 为 false", () => {
  assert.strictEqual(simd.SIMD_PROBE[14], 0x7b, "索引 14 应是 v128");
  assert.strictEqual(
    WebAssembly.validate(mutated(14, 0x7f)),
    false,
    "函数体压的是 v128，签名改成 i32 后类型不符，validate 应为 false",
  );
});

test("同构的纯标量模块 validate 为 true —— 外壳本身是合法的", () => {
  // 与探测模块结构完全相同，只是把 v128 换成 i32、函数体换成 i32.const 0。
  // 它为 true 说明：不支持 SIMD 的引擎对探测模块返回 false，只可能是因为
  // SIMD，而不是因为模块被写错了。
  // prettier-ignore
  const scalar = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
    0x03, 0x02, 0x01, 0x00,
    0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x00, 0x0b,
  ]);
  assert.strictEqual(WebAssembly.validate(scalar), true);
});

test("detectSimd() 记忆化，且与未记忆化的 probeSimd() 一致", () => {
  simd.resetSimdCache();
  const first = simd.detectSimd();
  assert.strictEqual(first, simd.probeSimd());
  assert.strictEqual(simd.detectSimd(), first, "第二次调用应返回同一结果");
});

test("parseEnvSimd 认真值 / 假值，未设置返回 undefined", () => {
  for (const v of ["1", "true", "TRUE", " on ", "yes"]) {
    assert.strictEqual(simd.parseEnvSimd(v), true, `${JSON.stringify(v)}`);
  }
  for (const v of ["0", "false", "OFF", " no "]) {
    assert.strictEqual(simd.parseEnvSimd(v), false, `${JSON.stringify(v)}`);
  }
  for (const v of [undefined, null, ""]) {
    assert.strictEqual(simd.parseEnvSimd(v), undefined);
  }
});

test("parseEnvSimd 对无法识别的值抛错，不是静默忽略", () => {
  // 静默忽略 OPENCV_SIMD=ture 会让用户以为自己强制了 SIMD，实际跑的是探测
  // 结果——「以为查了、其实没查」正是本仓库一路在清的那个失败模式。
  assert.throws(() => simd.parseEnvSimd("ture"), {
    name: "TypeError",
    message: /OPENCV_SIMD 的值无法识别/,
  });
  assert.throws(() => simd.parseEnvSimd("2"), { name: "TypeError" });
});

test("resolveVariant 优先级：options > 环境变量 > 探测", () => {
  const envOn = { OPENCV_SIMD: "1" };
  const envOff = { OPENCV_SIMD: "0" };

  assert.deepStrictEqual(simd.resolveVariant({ simd: true }, envOff), {
    variant: "simd",
    source: "option",
  });
  assert.deepStrictEqual(simd.resolveVariant({ simd: false }, envOn), {
    variant: "baseline",
    source: "option",
  });
  assert.deepStrictEqual(simd.resolveVariant(undefined, envOn), {
    variant: "simd",
    source: "env",
  });
  assert.deepStrictEqual(simd.resolveVariant({}, envOff), {
    variant: "baseline",
    source: "env",
  });
  assert.deepStrictEqual(simd.resolveVariant(undefined, {}), {
    variant: simd.detectSimd() ? "simd" : "baseline",
    source: "probe",
  });
});

test("resolveVariant 拒绝非 boolean 的 simd 与非对象的 options", () => {
  // 注意 { simd: null } 也要抛：null !== undefined，它是「传了个不认识的值」，
  // 不是「没传」。静默当成没传就又回到探测，用户以为自己指定了变体。
  for (const bad of ["true", 1, 0, null, {}]) {
    assert.throws(() => simd.resolveVariant({ simd: bad }, {}), {
      name: "TypeError",
      message: /只接受 boolean/,
    });
  }
  assert.throws(() => simd.resolveVariant("baseline", {}), {
    name: "TypeError",
    message: /必须是对象/,
  });
  // null / undefined 都当作「没传 options」
  assert.strictEqual(simd.resolveVariant(null, {}).source, "probe");
  assert.strictEqual(simd.resolveVariant(undefined, {}).source, "probe");
});

test("dist/ 是分变体布局：baseline 必在，顶层不再有扁平的 glue", () => {
  // 这条盯的是 build/assemble.sh 的输出形状。两个变体的 .wasm 文件名都是编译期
  // 烘焙的 "opencv_js.wasm"，必须分目录存放；一旦有人把布局改回扁平，
  // src/js/index.js 里 require("./baseline/opencv.js") 会找不到文件，
  // 而那时报出来的错（MODULE_NOT_FOUND）会被自动模式当成「simd 变体缺失」
  // 一类的正常情况处理，未必一眼看得出根因。
  for (const f of ["opencv.js", "opencv_js.wasm"]) {
    assert.ok(
      fs.existsSync(path.join(DIST, "baseline", f)),
      `缺少 dist/baseline/${f}`,
    );
    assert.ok(
      !fs.existsSync(path.join(DIST, f)),
      `dist/${f} 不该存在——2.1 起产物按变体分目录`,
    );
  }
  // simd 是可选的（本地可能只构了 baseline），但只要目录在，两个文件都得在。
  if (fs.existsSync(path.join(DIST, "simd"))) {
    for (const f of ["opencv.js", "opencv_js.wasm"]) {
      assert.ok(
        fs.existsSync(path.join(DIST, "simd", f)),
        `dist/simd/ 存在但缺少 ${f}`,
      );
    }
  }
});
