"use strict";

// 产物的 OpenCV 版本必须与 build/opencv-version.txt 一致。
//
// ci.yml 测的不是现场构建的产物，而是 build-wasm.yml「最近一次成功运行」上传的那份，
// 而那一趟可能跑在别的分支、别的版本上（workflow_dispatch 不限 ref）。此前唯一的版本
// 判据是「CascadeClassifier 不在」，它只分得清 4.x 与 5.x：同为 5.x 的另一个小版本，
// 或者别的分支上改过白名单的构建，照样全绿。这里直接比版本号。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { getCv } = require("../helpers");

const VERSION_FILE = path.join(
  __dirname,
  "..",
  "..",
  "build",
  "opencv-version.txt",
);

test("产物的 OpenCV 版本与 build/opencv-version.txt 一致", async () => {
  const cv = await getCv();
  const want = fs.readFileSync(VERSION_FILE, "utf8").trim();
  const m = /General configuration for OpenCV (\S+)/.exec(
    cv.getBuildInformation(),
  );
  assert.ok(m, "getBuildInformation() 里找不到版本行 —— 输出格式变了？");
  assert.strictEqual(
    m[1],
    want,
    `产物是 OpenCV ${m[1]}，但 build/opencv-version.txt 钉的是 ${want} —— ` +
      `CI 取到的可能是别的分支或别的版本构建出来的产物`,
  );
});
