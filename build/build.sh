#!/usr/bin/env bash
# 在 emsdk 容器内构建 OpenCV.js。宿主机不需要任何工具链。
#
# 用法: build/build.sh [--simd | --single-file]
#
# 三个变体（互斥，最多传一个）:
#
#   参数            变体名       产物目录                 产物
#   ------------    ----------   ----------------------   -----------------------------
#   (无)            baseline     build/out/baseline/      opencv.js + opencv_js.wasm
#   --simd          simd         build/out/simd/          opencv.js + opencv_js.wasm
#   --single-file   singlefile   build/out/singlefile/    opencv.js（wasm 已 base64 内联）
#
#   --simd 透传给 build_js.py，实际效果是两处（对着上游 platforms/js/build_js.py
#   核对）: CMake 侧 -DCV_ENABLE_INTRINSICS=ON（不带 --simd 时是 OFF，即基线版
#   连标量 intrinsics 也关着）、链接侧 -msimd128。它**不**启用线程——上游的
#   --threads 是另一个独立开关，本脚本不用它，因此产物不需要 SharedArrayBuffer，
#   也就不需要 COOP/COEP 响应头。
#
#   --single-file 是「不传 --disable_single_file」。上游的取反逻辑写在
#   build_js.py 的 get_build_flags(): `if not self.options.disable_single_file:
#   flags += "-s SINGLE_FILE=1 "`。SINGLE_FILE=1 会把 wasm 以 base64 内联进
#   opencv.js（体积约 +33%），产出**单个**文件，浏览器 <script> 可直接引用、
#   不必再托管 .wasm、也不受 file:// 下 fetch 被 CORS 拦截的影响。
#   代价：多出三分之一体积、且无法与 .wasm 分开做流式编译。
#
#   ⚠️ 单文件变体走的是 baseline（不带 SIMD），这是刻意的：它的使用场景是
#   <script> 直接引用，那条路径上**没有任何回退机制**——运行时探测器
#   （src/js/simd.js）只服务于 CommonJS 入口 dist/index.js。SIMD 的浏览器
#   覆盖率是 93.57%（Chrome 91+ / Firefox 89+ / Safari 16.4+），发一个无回退的
#   SIMD 单文件版等于让 6.4% 的浏览器直接白屏。需要 SIMD 的用户走 npm 包，
#   那条路径有探测和回退。
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
#   注意 wasm 文件不叫 opencv.wasm——这不是笔误。emscripten 把 wasm 侧文件名
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
#   ⚠️ 这条正是 baseline 与 simd 必须**分目录**存放的原因：两个变体的 .wasm
#   文件名都是编译期烘焙的 "opencv_js.wasm",谁都改不动,放同一个目录必然互相
#   覆盖。dist/ 下的布局因此是 dist/baseline/ 与 dist/simd/ 两个子目录,各自
#   持有配对的 opencv.js + opencv_js.wasm（见 build/assemble.sh）。
#
#   两条可独立核对的旁证(都在上游仓库,不依赖本仓库任何未提交的文件):
#   - opencv/opencv#13356 附带的完整构建日志里有
#       [100%] Linking CXX executable ../../bin/opencv_js.js
#     ——链接目标名就是 opencv_js,产物落在 bin/ 下。(该 issue 本身报的是
#     "构建后 bin/ 里没有 .wasm",结论是 SINGLE_FILE 把 wasm 以 base64
#     内联进了 opencv.js;这也正是 --single-file 变体所依赖的那个行为。)
#   - opencv/opencv#19243 的评论里有 emscripten 的报错行
#       em++: error: '.../upstream/bin/wasm2js --emscripten -O ../../bin/opencv_js.wasm ...' failed
#     ——直接给出 bin/opencv_js.wasm 这个路径。(注意这是 --disable_wasm
#     构建的失败输出,不是成功日志;它能证明的只是文件名,不是别的。)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCV_VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/build/opencv-version.txt")"
IMAGE_TAG="opencvjs-build:${OPENCV_VERSION}"
OUT_DIR="${REPO_ROOT}/build/out"

# 拆分版 glue 实测约 143 KB；单文件版把 8.5 MB 的 wasm 以 base64 内联，约 11 MB。
# 两者相差近两个数量级，2 MB 这条线落在中间任何位置都足以判别，取整为 2 MB。
# 同一条判据在 build/assemble.sh 与 test/smoke/wasm-artifact.test.js 里各有一份。
INLINE_THRESHOLD=$((2 * 1024 * 1024))

if (( $# > 1 )); then
  echo "只接受一个变体参数（--simd 与 --single-file 互斥），收到 $#: $*" >&2
  exit 1
fi

SIMD_FLAG=""
SINGLE_FILE="0"
BUILD_SUBDIR="baseline"
case "${1:-}" in
  "") ;;
  --simd)
    SIMD_FLAG="--simd"
    BUILD_SUBDIR="simd"
    ;;
  --single-file)
    SINGLE_FILE="1"
    BUILD_SUBDIR="singlefile"
    ;;
  *)
    echo "未知参数: ${1}（仅支持 --simd | --single-file）" >&2
    exit 1
    ;;
esac

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

# 先清空再建：留着上一次的产物会让下面那组不变量检查失去意义——构建若在
# cp 之前失败，陈旧文件仍在原地，检查照样通过，于是一次失败的构建被报成成功。
# 代价是构建失败时旧产物一并丢失，这是刻意的取舍：宁可重跑，也不要一个
# 「查了但查的是上次的东西」的绿灯。
rm -rf "${OUT_DIR:?}/${BUILD_SUBDIR}"
mkdir -p "${OUT_DIR}/${BUILD_SUBDIR}"

#   下面这段容器内脚本用单引号整体传给内层 bash -c——外层 shell 不对其做任何
#   变量展开，脚本文本本身是纯字面量。OPENCV_VERSION/SIMD_FLAG/EXTRA_CMAKE_OPTIONS/
#   SINGLE_FILE 一律通过位置参数（$1/$2/$3/$4，紧跟在单引号脚本之后的
#   `bash "${...}"...`）传入，内层脚本只以 "$1".."$4" 引用、装进数组再展开
#   (`"${arr[@]}"`)。这样即便 EXTRA_CMAKE_OPTIONS 里含引号、分号、$() 等 shell
#   元字符，也只是不透明的字符串数据，不会被内层 bash 当脚本语法二次解析——
#   消除了旧写法（把值拼进双引号字符串再整体喂给 bash -c）天然带有的注入面。
docker run --rm \
  -v "${REPO_ROOT}/src/config:/config:ro" \
  -v "${OUT_DIR}/${BUILD_SUBDIR}:/out" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c '
    opencv_version="$1"
    simd_flag="$2"
    extra_cmake_options="$3"
    single_file="$4"

    git clone --depth 1 --branch "${opencv_version}" https://github.com/opencv/opencv.git /work/opencv
    cd /work/opencv

    build_js_args=(
      /work/build_js
      --build_wasm
      --config
      /config/opencv_js.config.py
      --emscripten_dir
      "$EMSDK/upstream/emscripten"
    )
    # 取反：不要单文件时才传 --disable_single_file（上游是 store_true 的
    # disable_* 开关，不传即 SINGLE_FILE=1）。
    if [[ "${single_file}" != "1" ]]; then
      build_js_args+=(--disable_single_file)
    fi
    if [[ -n "${simd_flag}" ]]; then
      build_js_args+=("${simd_flag}")
    fi
    if [[ -n "${extra_cmake_options}" ]]; then
      build_js_args+=("--cmake_option=${extra_cmake_options}")
    fi

    python3 ./platforms/js/build_js.py "${build_js_args[@]}"

    cp -v /work/build_js/bin/opencv.js /out/
    if [[ "${single_file}" != "1" ]]; then
      # 拆分构建：.wasm 必须存在，不存在就让 cp 失败（set -e）而不是静默少拷一个文件。
      cp -v /work/build_js/bin/opencv_js.wasm /out/
    fi
  ' bash "${OPENCV_VERSION}" "${SIMD_FLAG}" "${EXTRA_CMAKE_OPTIONS}" "${SINGLE_FILE}"

# ── 产物不变量检查 ──────────────────────────────────────────────────────────
# 在宿主机上查（而不是容器里）：查的是最终落盘的那份东西，和使用者拿到的一致。
# 两个方向都查——只查一边等于默认另一边不会错。变体传错、上游改掉 SINGLE_FILE
# 的取反逻辑、或 build_js.py 换了产物路径，都会在这里当场失败，而不是拖到
# assemble 或运行时才暴露。
GLUE="${OUT_DIR}/${BUILD_SUBDIR}/opencv.js"
WASM="${OUT_DIR}/${BUILD_SUBDIR}/opencv_js.wasm"
GLUE_SIZE=$(wc -c < "${GLUE}" | tr -d '[:space:]')

if [[ "${SINGLE_FILE}" == "1" ]]; then
  if (( GLUE_SIZE <= INLINE_THRESHOLD )); then
    echo "❌ 单文件变体的 opencv.js 只有 ${GLUE_SIZE} 字节（<= ${INLINE_THRESHOLD}）——" >&2
    echo "   SINGLE_FILE=1 没生效，wasm 没被内联进来。" >&2
    exit 1
  fi
  if [[ -e "${WASM}" ]]; then
    echo "❌ 单文件变体不该有独立的 opencv_js.wasm，却存在: ${WASM}" >&2
    exit 1
  fi
else
  if [[ ! -f "${WASM}" ]]; then
    echo "❌ 缺少 ${WASM} —— --disable_single_file 没生效？" >&2
    exit 1
  fi
  if (( GLUE_SIZE > INLINE_THRESHOLD )); then
    echo "❌ ${GLUE} 有 ${GLUE_SIZE} 字节（> ${INLINE_THRESHOLD}）—— wasm 可能仍被内联进了 JS" >&2
    exit 1
  fi
fi

echo "==> 产物:"
ls -la "${OUT_DIR}/${BUILD_SUBDIR}"
