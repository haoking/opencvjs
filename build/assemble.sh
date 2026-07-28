#!/usr/bin/env bash
# 把 wasm 产物与手写扩展层组装成可发布的 dist/。
#
# 用法: build/assemble.sh [产物目录]
#
#   产物目录默认取 $OPENCV_ARTIFACT，再默认 build/out/baseline（即 build/build.sh
#   的输出位置，也是 build-wasm.yml 上传的那个目录）。
#
# 组装结果:
#   dist/opencv.js        emscripten glue（约 143 KB）
#   dist/opencv_js.wasm   wasm 二进制（约 8.5 MB）
#   dist/index.js         包入口：加载 glue → 挂扩展 → 返回 cv（Promise）
#   dist/{guards,typed-access,mat-region,arithmetic,dft}.js
#   dist/index.d.ts       TypeScript 声明，由 build/gen-types.js 从**刚组装好的这份
#                         产物**dump 出来（不是手写的）——见该文件顶部的说明
#
# ⚠️ 两个文件名都不能改。glue 内部用的是编译期写死的字符串 "opencv_js.wasm"
#    （见 build/build.sh 顶部的长注释），Node 下由 glue 自己按 __dirname 拼路径
#    去读——所以 glue 和 .wasm 必须同目录同名，src/js/index.js 的 require("./opencv.js")
#    也要求 glue 与扩展层同目录。整个 dist/ 是扁平的，正是为此。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${1:-${OPENCV_ARTIFACT:-${REPO_ROOT}/build/out/baseline}}"
DIST_DIR="${REPO_ROOT}/dist"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "❌ 产物目录不存在: ${SRC_DIR}" >&2
  echo "   先跑 build/build.sh，或把 CI 产物解压到该目录，或传目录作为第一个参数。" >&2
  exit 1
fi

for f in opencv.js opencv_js.wasm; do
  if [[ ! -f "${SRC_DIR}/${f}" ]]; then
    echo "❌ 缺少 ${SRC_DIR}/${f}" >&2
    exit 1
  fi
done

# glue 超过 2 MB 说明 --disable_single_file 没生效、wasm 被 base64 内联了进去。
# 这跟 test/smoke/wasm-artifact.test.js 的那条断言是同一个判据。
GLUE_SIZE=$(wc -c < "${SRC_DIR}/opencv.js" | tr -d '[:space:]')
if (( GLUE_SIZE > 2 * 1024 * 1024 )); then
  echo "❌ ${SRC_DIR}/opencv.js 有 ${GLUE_SIZE} 字节（>2MB）——wasm 可能仍被内联进了 JS" >&2
  exit 1
fi

# 全量重建，避免上一次组装留下的陈旧文件（例如某个模块被删掉后仍留在 dist/）。
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

cp "${SRC_DIR}/opencv.js" "${SRC_DIR}/opencv_js.wasm" "${DIST_DIR}/"
cp "${REPO_ROOT}"/src/js/*.js "${DIST_DIR}/"

# .d.ts 必须在这里生成、且必须用刚拷进去的这份产物：它的内容就是 Object.keys(cv) 的
# dump。任何「先生成、后换产物」的顺序都会让声明与运行时脱节——那正是本项目要修的
# 那个毛病。生成失败即整个组装失败（set -e），不允许 dist/ 里出现一份陈旧的声明。
node "${REPO_ROOT}/build/gen-types.js" "${DIST_DIR}"

echo "==> dist/:"
ls -la "${DIST_DIR}"
