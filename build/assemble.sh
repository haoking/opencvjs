#!/usr/bin/env bash
# 把 wasm 产物与手写扩展层组装成可发布的 dist/。
#
# 用法: build/assemble.sh [baseline 产物目录] [simd 产物目录]
#
#   baseline 目录默认取 $OPENCV_ARTIFACT，再默认 build/out/baseline
#   simd     目录默认取 $OPENCV_ARTIFACT_SIMD，再默认 build/out/simd
#   （二者分别是 build/build.sh 与 build/build.sh --simd 的输出位置，
#     也是 build-wasm.yml 上传的那两个 artifact 解压后的目录。）
#
# 组装结果:
#   dist/baseline/opencv.js + opencv_js.wasm   无 SIMD 的回退产物（必须有）
#   dist/simd/opencv.js     + opencv_js.wasm   -msimd128 产物（可选，见下）
#   dist/index.js         包入口：探测 SIMD → 加载对应变体 → 挂扩展 → 返回 cv（Promise）
#   dist/{simd-detect,guards,typed-access,mat-region,arithmetic,dft}.js
#   dist/index.d.ts       TypeScript 声明，由 build/gen-types.js 从**刚组装好的这份
#                         产物**dump 出来（不是手写的）——见该文件顶部的说明
#
# ⚠️ 两个变体必须**分目录**。glue 内部引用的 wasm 文件名是编译期写死的字符串
#    "opencv_js.wasm"（见 build/build.sh 顶部的长注释），两个变体的 wasm 因此同名，
#    放同一目录必然互相覆盖；改名则运行时 404。每个子目录里必须各放一份 glue，
#    与同目录的 .wasm 原样配对——glue 在 Node 下按 __dirname 定位 .wasm。
#
#    ⚠️ 这里曾经写着「两个变体的 glue 内容也不同，不能共用一份」。那是**错的**：
#    实测两份 glue 逐字节相同（SHA-256 均为 da1f9d19…）。分目录的理由只有 .wasm
#    同名这一条。反过来也别依赖「它们永远相同」——同样没有依据。
#
#    扩展层（index.js 等）仍留在 dist/ 顶层：它是与变体无关的纯 JS，且
#    src/js/index.js 里 require("./baseline/opencv.js") 的相对路径正是按这个
#    布局写的。
#
# 环境变量:
#   OPENCV_REQUIRE_SIMD=1   simd 产物缺失时从「警告并继续」升级为「直接失败」。
#                           CI 里必须设：那条链路本来就该有两个变体，缺一个说明
#                           矩阵作业出了问题，此时组装出一份只有 baseline 的
#                           dist/ 然后照常报绿，就是又一个会说谎的绿灯。
#                           本地开发不设，允许只 assemble baseline。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_SRC="${1:-${OPENCV_ARTIFACT:-${REPO_ROOT}/build/out/baseline}}"
SIMD_SRC="${2:-${OPENCV_ARTIFACT_SIMD:-${REPO_ROOT}/build/out/simd}}"
DIST_DIR="${REPO_ROOT}/dist"

# glue 超过 2 MB 说明 --disable_single_file 没生效、wasm 被 base64 内联了进去。
# 这跟 build/build.sh 与 test/smoke/wasm-artifact.test.js 的判据是同一条。
INLINE_THRESHOLD=$((2 * 1024 * 1024))

# 校验一个变体产物目录：两个文件都在、glue 没把 wasm 内联进去。
check_variant() {
  local dir="$1" name="$2" f size
  for f in opencv.js opencv_js.wasm; do
    if [[ ! -f "${dir}/${f}" ]]; then
      echo "❌ ${name} 变体缺少 ${dir}/${f}" >&2
      return 1
    fi
  done
  size=$(wc -c < "${dir}/opencv.js" | tr -d '[:space:]')
  if (( size > INLINE_THRESHOLD )); then
    echo "❌ ${dir}/opencv.js 有 ${size} 字节（> ${INLINE_THRESHOLD}）——wasm 可能仍被内联进了 JS" >&2
    echo "   单文件变体不参与 npm 打包，不要把它传给本脚本。" >&2
    return 1
  fi
  return 0
}

if [[ ! -d "${BASELINE_SRC}" ]]; then
  echo "❌ baseline 产物目录不存在: ${BASELINE_SRC}" >&2
  echo "   先跑 build/build.sh，或把 CI 产物解压到该目录，或把目录作为第一个参数传入。" >&2
  exit 1
fi
check_variant "${BASELINE_SRC}" baseline

# simd 是可选的：本地没有 Docker 时只能构出 baseline，那时仍要允许组装出一份
# 能跑测试的 dist/。缺失时 dist/simd/ 干脆不存在，运行时探测会回落到 baseline
# 并打一条 warning（见 src/js/index.js）——**不**拿 baseline 冒充 simd，
# 那会让「强制 SIMD 跑一遍」测到的其实是 baseline。
HAS_SIMD=0
if [[ -d "${SIMD_SRC}" ]]; then
  check_variant "${SIMD_SRC}" simd
  HAS_SIMD=1
elif [[ "${OPENCV_REQUIRE_SIMD:-}" == "1" ]]; then
  echo "❌ OPENCV_REQUIRE_SIMD=1 但 simd 产物目录不存在: ${SIMD_SRC}" >&2
  exit 1
else
  echo "⚠️  simd 产物目录不存在: ${SIMD_SRC}"
  echo "    dist/ 将只含 baseline；运行时探测会回落到 baseline，强制 OPENCV_SIMD=1 会报错。"
fi

# 全量重建，避免上一次组装留下的陈旧文件（例如某个模块被删掉后仍留在 dist/，
# 或上一次组装带了 dist/simd/、这一次没有）。
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/baseline"

cp "${BASELINE_SRC}/opencv.js" "${BASELINE_SRC}/opencv_js.wasm" "${DIST_DIR}/baseline/"
if (( HAS_SIMD )); then
  mkdir -p "${DIST_DIR}/simd"
  cp "${SIMD_SRC}/opencv.js" "${SIMD_SRC}/opencv_js.wasm" "${DIST_DIR}/simd/"
fi
cp "${REPO_ROOT}"/src/js/*.js "${DIST_DIR}/"

# .d.ts 必须在这里生成、且必须用刚拷进去的这份产物：它的内容就是 Object.keys(cv) 的
# dump。任何「先生成、后换产物」的顺序都会让声明与运行时脱节——那正是本项目要修的
# 那个毛病。生成失败即整个组装失败（set -e），不允许 dist/ 里出现一份陈旧的声明。
#
# gen-types.js 内部固定以 { simd: false } 加载（理由见该文件 main() 处的注释）。
node "${REPO_ROOT}/build/gen-types.js" "${DIST_DIR}"

echo "==> dist/:"
ls -la "${DIST_DIR}"
for v in baseline simd; do
  # 写成 if 而不是 `[[ ... ]] && ls`：后者在 dist/simd/ 不存在时，整条 AND-list
  # 的退出码就是 1，而它是脚本的最后一条命令 —— set -e 下脚本会以 1 退出，
  # 一次完全正常的 baseline-only 组装被报成失败。
  if [[ -d "${DIST_DIR}/${v}" ]]; then
    ls -la "${DIST_DIR}/${v}"
  fi
done
