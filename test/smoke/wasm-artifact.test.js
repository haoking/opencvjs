"use strict";

// 验证新构建的 wasm 产物可用。通过环境变量 OPENCV_ARTIFACT 指向待测产物，
// 未设置时跳过——这样它在常规 npm test 中不会因找不到产物而失败。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const artifact = process.env.OPENCV_ARTIFACT;

test(
  "新构建的 wasm 产物冒烟验证",
  {
    skip: !artifact ? "未设置 OPENCV_ARTIFACT" : false,
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

    const mod = require(jsPath);
    const cv = typeof mod.then === "function" ? await mod : mod;
    if (typeof cv.onRuntimeInitialized === "function" || !cv.Mat) {
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
