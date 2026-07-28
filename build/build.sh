#!/usr/bin/env bash
# 在 emsdk 容器内构建 OpenCV.js。宿主机不需要任何工具链。
#
# 用法: build/build.sh [--simd]
#
# 环境变量:
#   EXTRA_CMAKE_OPTIONS   可选,默认不设置。透传给 build_js.py 的一个
#                         --cmake_option 值,例如:
#                           EXTRA_CMAKE_OPTIONS='-DBUILD_opencv_dnn=OFF' build/build.sh
#                         只支持单个 -D 值(build_js.py 的 --cmake_option 是
#                         "append" 型参数,每个 -D 都要单独一个 --cmake_option;
#                         这里没有做多值拆分)。如需一次传多个,请扩展本脚本。
#                         默认不设置的原因见下方 --cmake_option 透传逻辑的注释。
#
# 产物: build/out/<baseline|simd>/opencv.js + opencv_js.wasm
#
#   注意第二个文件不叫 opencv.wasm——这不是笔误。emscripten 把 wasm 侧文件名
#   作为编译期常量({{{ WASM_BINARY_FILE }}},定义于 emscripten 的
#   src/preamble.js)直接写死进 opencv.js 的内容里,取值来自链接时的 CMake
#   目标名 opencv_js(modules/js/CMakeLists.txt 里 ocv_add_executable(${the_module}...)
#   而 the_module=opencv_js),也就是说原始产物其实是 opencv_js.js + opencv_js.wasm。
#   随后 modules/js/src/make_umd.py 只是把 opencv_js.js 的文本内容包一层 UMD
#   壳、另存为 opencv.js(纯文本操作,不改内容、不碰 .wasm 文件),所以最终
#   opencv.js 内部引用的仍然是字符串 "opencv_js.wasm"。两个文件必须原名配对;
#   如果把 .wasm 重命名成 opencv.wasm,浏览器/Node 运行时会去 fetch
#   opencv_js.wasm 而 404。
#
#   两条可独立核对的旁证(都在上游仓库,不依赖本仓库任何未提交的文件):
#   - opencv/opencv#13356 附带的完整构建日志里有
#       [100%] Linking CXX executable ../../bin/opencv_js.js
#     ——链接目标名就是 opencv_js,产物落在 bin/ 下。(该 issue 本身报的是
#     "构建后 bin/ 里没有 .wasm",结论是 SINGLE_FILE 把 wasm 以 base64
#     内联进了 opencv.js;这正是本脚本要传 --disable_single_file 的原因。)
#   - opencv/opencv#19243 的评论里有 emscripten 的报错行
#       em++: error: '.../upstream/bin/wasm2js --emscripten -O ../../bin/opencv_js.wasm ...' failed
#     ——直接给出 bin/opencv_js.wasm 这个路径。(注意这是 --disable_wasm
#     构建的失败输出,不是成功日志;它能证明的只是文件名,不是别的。)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCV_VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/build/opencv-version.txt")"
IMAGE_TAG="opencvjs-build:${OPENCV_VERSION}"
OUT_DIR="${REPO_ROOT}/build/out"

SIMD_FLAG=""
BUILD_SUBDIR="baseline"
if [[ "${1:-}" == "--simd" ]]; then
  SIMD_FLAG="--simd"
  BUILD_SUBDIR="simd"
elif [[ -n "${1:-}" ]]; then
  echo "未知参数: ${1}(仅支持 --simd)" >&2
  exit 1
fi

# --cmake_option 透传入口。默认不设置、默认不禁用 dnn:
# - src/config/opencv_js.config.py 的白名单已移除 dnn,但那只影响 embind
#   绑定生成,不影响 CMake 是否编译 dnn 模块——build_js.py:126 硬编码
#   -DBUILD_opencv_dnn=ON,且没有 --disable_dnn 选项,产物里仍会带着 dnn 的
#   C++ 代码,体积不会因白名单而显著减小。
# - objdetect 对 dnn 是可选依赖(face_detect.cpp 调用 dnn::readNet),白名单
#   里保留的 FaceDetectorYN 要靠它。真传 -DBUILD_opencv_dnn=OFF 能否编译通过、
#   FaceDetectorYN 会变成什么行为,都还没有验证过,有风险。
# - 本任务的目标是先把构建链路跑通,体积优化留到链路打通之后再试。因此默认
#   不传任何 --cmake_option,只留这一个入口给以后需要时使用。
: "${EXTRA_CMAKE_OPTIONS:=}"

echo "==> OpenCV ${OPENCV_VERSION}, 变体: ${BUILD_SUBDIR}"
if [[ -n "${EXTRA_CMAKE_OPTIONS}" ]]; then
  echo "==> 额外 CMake 参数: ${EXTRA_CMAKE_OPTIONS}"
fi

docker build -t "${IMAGE_TAG}" -f "${REPO_ROOT}/build/Dockerfile" "${REPO_ROOT}"

mkdir -p "${OUT_DIR}/${BUILD_SUBDIR}"

#   下面这段容器内脚本用单引号整体传给内层 bash -c——外层 shell 不对其做任何
#   变量展开，脚本文本本身是纯字面量。OPENCV_VERSION/SIMD_FLAG/EXTRA_CMAKE_OPTIONS
#   一律通过位置参数（$1/$2/$3，紧跟在单引号脚本之后的 `bash "${...}"...`）
#   传入，内层脚本只以 "$1"/"$2"/"$3" 引用、装进数组再展开(`"${arr[@]}"`)。
#   这样即便 EXTRA_CMAKE_OPTIONS 里含引号、分号、$() 等 shell 元字符，也只是
#   不透明的字符串数据，不会被内层 bash 当脚本语法二次解析——消除了旧写法
#   （把值拼进双引号字符串再整体喂给 bash -c）天然带有的注入面。
docker run --rm \
  -v "${REPO_ROOT}/src/config:/config:ro" \
  -v "${OUT_DIR}/${BUILD_SUBDIR}:/out" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c '
    opencv_version="$1"
    simd_flag="$2"
    extra_cmake_options="$3"

    git clone --depth 1 --branch "${opencv_version}" https://github.com/opencv/opencv.git /work/opencv
    cd /work/opencv

    build_js_args=(
      /work/build_js
      --build_wasm
      --disable_single_file
      --config
      /config/opencv_js.config.py
      --emscripten_dir
      "$EMSDK/upstream/emscripten"
    )
    if [[ -n "${simd_flag}" ]]; then
      build_js_args+=("${simd_flag}")
    fi
    if [[ -n "${extra_cmake_options}" ]]; then
      build_js_args+=("--cmake_option=${extra_cmake_options}")
    fi

    python3 ./platforms/js/build_js.py "${build_js_args[@]}"
    cp -v /work/build_js/bin/opencv.js      /out/
    cp -v /work/build_js/bin/opencv_js.wasm /out/
  ' bash "${OPENCV_VERSION}" "${SIMD_FLAG}" "${EXTRA_CMAKE_OPTIONS}"

echo "==> 产物:"
ls -la "${OUT_DIR}/${BUILD_SUBDIR}"
