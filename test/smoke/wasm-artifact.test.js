"use strict";

// 验证新构建的 wasm 产物可用。通过环境变量 OPENCV_ARTIFACT 指向待测产物。
//
// 本地开发时未设置 OPENCV_ARTIFACT 就跳过——常规 npm test 不该因为本机没有
// 构建产物而失败。
//
// 但在「本来就该有产物」的场合，跳过必须变成失败：这个测试是 60–150 分钟
// wasm 构建的**唯一**验证。实测过，未设 OPENCV_ARTIFACT 时
// `node --test test/smoke/*.test.js` 退出码是 0——env 名字写错、路径拼错、
// 上游步骤没产出目录，任何一种都会让那 2.5 小时的构建在「零验证」下把
// workflow 报绿。门禁报绿却什么都没查，比没有门禁更糟。
//
// 判据用的是 OPENCV_SMOKE_REQUIRED，**不是** process.env.CI。
// 用 CI 是错的，已实测：GitHub Actions 给每个步骤都设 CI=true，而
// .github/workflows/ci.yml 的 `npm test` glob（test/*/*.test.js）也会匹配到
// 本文件——那条链路测的是仓库里现成的 asm.js，本来就没有、也不该有 wasm
// 产物。以 CI 为判据会让 ci.yml 在 Node 18/20/22 三个矩阵项上全部失败
// （本机 `CI=true npm test` 实测 fail 1、exit 1）。真正需要这条守卫的是
// build-wasm.yml 里那个专门的冒烟步骤，它显式声明 OPENCV_SMOKE_REQUIRED=1。
//
// 该步骤另有一重不依赖 Node 的守卫：进 node 之前先在 shell 里
// `test -d "$OPENCV_ARTIFACT"`。两者互为保险，都不依赖对方生效。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const artifact = process.env.OPENCV_ARTIFACT;

if (!artifact && process.env.OPENCV_SMOKE_REQUIRED) {
  throw new Error(
    "OPENCV_SMOKE_REQUIRED 已置位但 OPENCV_ARTIFACT 未设置 —— " +
      "冒烟测试是 wasm 构建的唯一验证，静默跳过等于让 60–150 分钟的构建" +
      "在零验证下报绿。本地开发不设这两个变量时会正常跳过。",
  );
}

test(
  "新构建的 wasm 产物冒烟验证",
  {
    skip: !artifact ? "未设置 OPENCV_ARTIFACT（本地开发）" : false,
    // 有限超时：wasm 实例化正常应在秒级完成；若 onRuntimeInitialized 因
    // 加载失败而从不触发，不加超时会一直挂到 workflow 180 分钟的硬限才被
    // 杀掉——把本该秒级失败的问题变成最昂贵的失败方式。60s 对正常情况绰绰
    // 有余，对真正的挂起也能快速止损。
    timeout: 60000,
  },
  async () => {
    const jsPath = path.resolve(artifact, "opencv.js");
    const wasmPath = path.resolve(artifact, "opencv_js.wasm");

    assert.ok(fs.existsSync(jsPath), `缺少 ${jsPath}`);
    assert.ok(
      fs.existsSync(wasmPath),
      `缺少 ${wasmPath} —— --disable_single_file 未生效？`,
    );

    const jsSize = fs.statSync(jsPath).size;
    assert.ok(
      jsSize < 2 * 1024 * 1024,
      `opencv.js 有 ${(jsSize / 1048576).toFixed(1)}MB —— wasm 可能仍被 base64 内联进了 JS`,
    );

    // 加载就绪的判据只能是 cv.Mat 是否可用，不能看 onRuntimeInitialized 是否存在。
    // 实测（2026-07-28 首次真实构建产物）：新 wasm 产物的 require() 返回 Promise，
    // await 后 29ms 即就绪、cv.Mat 已是 function，但 emscripten **同时保留了
    // cv.onRuntimeInitialized 这个属性**。原判据写作
    //   typeof cv.onRuntimeInitialized === "function" || !cv.Mat
    // 时第一个子条件恒为真，于是即便已经就绪也会进入下面那个 Promise 等待，
    // 而此时初始化早已完成、回调永不再触发 —— 事件循环空转后被 Node 判为
    // failureType: 'cancelledByParent'（"Promise resolution is still pending
    // but the event loop has already resolved"）。首次 CI 构建正是栽在这里。
    const mod = require(jsPath);
    const cv = typeof mod.then === "function" ? await mod : mod;
    if (typeof cv.Mat !== "function") {
      await new Promise((resolve) => {
        cv.onRuntimeInitialized = resolve;
      });
    }

    // 基本可用性
    const m = cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]);
    assert.strictEqual(m.rows, 2);
    assert.deepStrictEqual(Array.from(m.data32F), [1, 2, 3, 4]);

    // clone 必须是深拷贝 —— 上游曾让它静默退化为浅拷贝 12 个月。
    // 每次换 OpenCV 版本都要重验，不能假定。
    const copy = m.clone();
    m.data32F[0] = 999;
    assert.strictEqual(copy.data32F[0], 1, "clone() 退化为浅拷贝");

    // 白名单必须保住 CascadeClassifier（5.x 移除了它，这是钉 4.x 的理由）
    assert.ok(
      typeof cv.CascadeClassifier === "function",
      "白名单丢失 CascadeClassifier",
    );

    // dnn 的 JS 绑定应已被裁掉（注意：dnn 的 C++ 代码仍在产物中——白名单只
    // 控制 embind 绑定生成，build_js.py 硬编码 -DBUILD_opencv_dnn=ON，体积
    // 不会因此显著下降。这里验证的是绑定已裁，不是 dnn 已从产物移除）。
    assert.strictEqual(cv.readNetFromTensorflow, undefined, "dnn 未被裁掉");

    m.delete();
    copy.delete();
  },
);
