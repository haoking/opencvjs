#!/usr/bin/env bash
# Builds OpenCV.js inside the emsdk container. The host needs no toolchain, only Docker.
#
# Usage: build/build.sh [--simd | --single-file]
#
# Three variants (mutually exclusive, at most one argument):
#
#   argument        variant      output directory         output
#   ------------    ----------   ----------------------   ------------------------------
#   (none)          baseline     build/out/baseline/      opencv.js + opencv_js.wasm
#   --simd          simd         build/out/simd/          opencv.js + opencv_js.wasm
#   --single-file   singlefile   build/out/singlefile/    opencv.js (wasm embedded)
#
#   --simd is passed through to build_js.py, where it does two things (checked against
#   upstream platforms/js/build_js.py): -DCV_ENABLE_INTRINSICS=ON on the CMake side (OFF
#   without --simd, so the baseline build has even scalar intrinsics off), and -msimd128
#   added to CMAKE_C_FLAGS / CMAKE_CXX_FLAGS, i.e. for compiling and linking. It does
#   **not** enable threads — upstream's --threads is a separate switch this script does
#   not use — so the output needs no SharedArrayBuffer and no COOP/COEP headers.
#
#   --single-file means "do not pass --disable_single_file": build_js.py's
#   get_build_flags() adds `-s SINGLE_FILE=1` unless disable_single_file is set.
#   SINGLE_FILE=1 embeds the wasm in opencv.js, producing **one** file that a browser
#   <script> can load directly, with no separate .wasm to host and no fetch() blocked by
#   CORS under file://. The cost is size, and no streaming compilation of a separate
#   .wasm. Since Emscripten 4.0.18 the wasm is embedded as a UTF-8–encoded binary string
#   by default (about 17% smaller than base64), so the script must be decoded as UTF-8:
#   serve it with `Content-Type: text/javascript; charset=utf-8`, or load it from a page
#   with <meta charset="utf-8"> or with <script charset="utf-8">.
#
#   The single-file variant is built without SIMD on purpose: it is meant for a direct
#   <script> include, a path with **no fallback** — the runtime detection in
#   src/js/simd-detect.js only serves the CommonJS entry dist/index.js. A SIMD
#   single-file build would fail outright on engines without WebAssembly SIMD (Chrome
#   < 91, Firefox < 89, Safari < 16.4). Users who want SIMD use the npm package, which
#   detects and falls back.
#
#   Flags evaluated and not adopted (emsdk 6.0.12, 2026-10; ms per operation over the
#   test/simd-compare.js cases, geometric mean against the shipped build):
#     -flto            +0.7% baseline / +1.3% simd, within noise; wasm +28% / +24%
#     -fwasm-exceptions +0.3%; wasm +10%; raises the engine floor to Chrome 95 /
#                      Firefox 100 / Safari 15.2, and native failures become
#                      WebAssembly.Exception objects instead of aborts (their text is
#                      readable through getExceptionMessage)
#     -mrelaxed-simd   −0.2%, no measurable gain; not every engine with SIMD has relaxed
#                      SIMD, so it would also need a third variant
#
# Environment:
#   EXTRA_CMAKE_OPTIONS   Optional, unset by default. Passed to build_js.py as one
#                         --cmake_option value, e.g.:
#                           EXTRA_CMAKE_OPTIONS='-DBUILD_opencv_dnn=OFF' build/build.sh
#                         Only a single -D value is supported: --cmake_option is an
#                         "append" argument that takes one -D per occurrence, and this
#                         script does not split values. Extend it if you need several.
#                         See the pass-through below for why nothing is set by default.
#
#   The wasm file is named opencv_js.wasm, not opencv.wasm, on purpose. Emscripten bakes
#   the wasm file name into opencv.js at compile time ({{{ WASM_BINARY_FILE }}} in
#   Emscripten's src/preamble.js), and the name comes from the CMake target opencv_js
#   (modules/js/CMakeLists.txt: ocv_add_executable(${the_module} ...) with
#   the_module=opencv_js), so the raw output is opencv_js.js + opencv_js.wasm.
#   modules/js/src/make_umd.py then only wraps opencv_js.js in a UMD shell and saves it
#   as opencv.js (a text operation that does not touch the .wasm), so opencv.js still
#   refers to the string "opencv_js.wasm". The two files must stay paired under their
#   original names: renamed to opencv.wasm, the runtime would fetch opencv_js.wasm and
#   get a 404.
#
#   This is why baseline and simd must live in **separate directories**: both variants'
#   .wasm files carry the compile-time name "opencv_js.wasm", which cannot be changed, so
#   one directory would make them overwrite each other. dist/ therefore has
#   dist/baseline/ and dist/simd/, each with its own paired opencv.js + opencv_js.wasm
#   (see build/assemble.sh).
#
#   Two pieces of evidence that can be checked independently (both upstream):
#   - The full build log attached to opencv/opencv#13356 contains
#       [100%] Linking CXX executable ../../bin/opencv_js.js
#     — the link target is opencv_js and the output lands in bin/. (The issue reports
#     "no .wasm in bin/ after the build"; the cause was SINGLE_FILE embedding the wasm in
#     opencv.js, the very behaviour the --single-file variant relies on.)
#   - A comment on opencv/opencv#19243 quotes the Emscripten error line
#       em++: error: '.../upstream/bin/wasm2js --emscripten -O ../../bin/opencv_js.wasm ...' failed
#     — which names bin/opencv_js.wasm. (That is the failure output of a --disable_wasm
#     build, not a success log; it proves the file name and nothing else.)
#
# Patches to the upstream sources:
#   build/patches/*.patch are applied with git apply, one by one, after OpenCV is cloned
#   in the container (each file starts with why it is needed). A patch that no longer
#   applies fails the build. Currently:
#   - opencv-js-deep-clone.patch: since Emscripten 4.0.0 the helpers.js code that
#     replaces Embind's shallow clone() with mat_clone never runs, so without the patch
#     clone() is a shallow copy.
#   - opencv-js-link-flags.patch: exports the runtime symbols the extension layer needs
#     (Emscripten no longer exports the HEAP* views by default), for the opencv_js target
#     only, and raises the memory limit from 1 GB to 2 GB.
#   - opencv-js-mcc-bindings.patch: lets the generated bindings for the MCC (Macbeth
#     ColorChecker) classes compile.
#   - opencv-mcc-chart-type-init.patch: initializes the MCC detector's chart type, which
#     upstream leaves uninitialized (detection then depends on leftover heap memory).
#   - opencv-wasm-v_round.patch: the wasm SIMD backend's v_round was off by one for
#     negative numbers and rounded .5 differently from cvRound.
#
# Pinned inputs: the OpenCV tag (build/opencv-version.txt) must resolve to the commit in
# build/opencv-commit.txt, and build/Dockerfile pins the emsdk image by digest.
# build/fingerprint.sh hashes every build input; CI names artifacts after it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCV_VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/build/opencv-version.txt")"
# The commit that tag must resolve to. A tag can be moved upstream; checking the commit
# keeps the build input fixed. Update both files together when moving to another release.
OPENCV_COMMIT="$(tr -d '[:space:]' < "${REPO_ROOT}/build/opencv-commit.txt")"
IMAGE_TAG="opencvjs-build:${OPENCV_VERSION}"
OUT_DIR="${REPO_ROOT}/build/out"

# The split glue is about 136 KB (emsdk 6.0.12); the single-file build embeds the wasm
# (about 12 MB for 5.0.0 baseline) and is about 13 MB. Two orders of magnitude apart, so
# any line in between tells them apart; 2 MB it is. The same threshold appears in
# build/assemble.sh and test/smoke/wasm-artifact.test.js.
INLINE_THRESHOLD=$((2 * 1024 * 1024))

if (( $# > 1 )); then
  echo "Only one variant argument is accepted (--simd and --single-file are mutually exclusive), got $#: $*" >&2
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
    echo "Unknown argument: ${1} (only --simd | --single-file)" >&2
    exit 1
    ;;
esac

# The --cmake_option pass-through. Unset by default, and dnn is not disabled by default:
# - The whitelist in src/config/opencv_js.config.py has no dnn entries, but that only
#   affects binding generation, not whether CMake builds the dnn module: build_js.py
#   hard-codes -DBUILD_opencv_dnn=ON and has no --disable_dnn option, so the dnn C++ code
#   is in the output either way and the whitelist does not shrink it much.
# - objdetect depends on dnn optionally (face_detect.cpp calls dnn::readNet), and the
#   whitelisted FaceDetectorYN needs it, as does mcc's CCheckerDetector. Whether
#   -DBUILD_opencv_dnn=OFF builds at all, and what those classes do then, is unverified.
: "${EXTRA_CMAKE_OPTIONS:=}"

echo "==> OpenCV ${OPENCV_VERSION}, variant: ${BUILD_SUBDIR}"
if [[ -n "${EXTRA_CMAKE_OPTIONS}" ]]; then
  echo "==> Extra CMake option: ${EXTRA_CMAKE_OPTIONS}"
fi

docker build -t "${IMAGE_TAG}" -f "${REPO_ROOT}/build/Dockerfile" "${REPO_ROOT}"

# Clear before building: leftovers from a previous build would defeat the invariant
# checks below — if the build failed before the cp, the stale files would still be in
# place, the checks would pass, and a failed build would be reported as a success. The
# old output is lost when a build fails; that is deliberate: rather rebuild than get a
# green light that checked the previous build.
rm -rf "${OUT_DIR:?}/${BUILD_SUBDIR}"
mkdir -p "${OUT_DIR}/${BUILD_SUBDIR}"

# The container script below is passed to the inner bash -c in single quotes, so the
# outer shell expands nothing in it. OPENCV_VERSION / SIMD_FLAG / EXTRA_CMAKE_OPTIONS /
# SINGLE_FILE / OPENCV_COMMIT arrive as positional parameters ($1..$5, after the quoted
# script), and the script only uses them as "$1".."$5" or through arrays ("${arr[@]}").
# Even if EXTRA_CMAKE_OPTIONS contains quotes, semicolons or $(...), it stays opaque
# data and is never parsed as shell syntax by the inner bash — unlike splicing the
# values into a double-quoted string for bash -c, which is an injection surface.
docker run --rm \
  -v "${REPO_ROOT}/src/config:/config:ro" \
  -v "${REPO_ROOT}/build/patches:/patches:ro" \
  -v "${OUT_DIR}/${BUILD_SUBDIR}:/out" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c '
    opencv_version="$1"
    simd_flag="$2"
    extra_cmake_options="$3"
    single_file="$4"
    opencv_commit="$5"

    git clone --depth 1 --branch "${opencv_version}" https://github.com/opencv/opencv.git /work/opencv
    cd /work/opencv
    actual_commit="$(git rev-parse HEAD)"
    if [[ "${actual_commit}" != "${opencv_commit}" ]]; then
      echo "❌ tag ${opencv_version} resolves to ${actual_commit}, expected ${opencv_commit} (build/opencv-commit.txt)" >&2
      exit 1
    fi

    # Patches to the upstream sources (build/patches/; each file says why). --check
    # first: if upstream changed the code and a patch no longer applies, the build fails
    # instead of silently producing an unpatched artifact.
    shopt -s nullglob
    for patch_file in /patches/*.patch; do
      git apply --check "${patch_file}"
      git apply "${patch_file}"
      echo "==> Applied patch: ${patch_file}"
    done

    build_js_args=(
      /work/build_js
      --build_wasm
      --config
      /config/opencv_js.config.py
      --emscripten_dir
      "$EMSDK/upstream/emscripten"
    )
    # Inverted: --disable_single_file is passed unless a single file is wanted (upstream
    # has a store_true disable_* switch; without it SINGLE_FILE=1).
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
      # Split build: the .wasm must exist; if it does not, let cp fail (set -e) instead of
      # silently copying one file fewer.
      cp -v /work/build_js/bin/opencv_js.wasm /out/
    fi
  ' bash "${OPENCV_VERSION}" "${SIMD_FLAG}" "${EXTRA_CMAKE_OPTIONS}" "${SINGLE_FILE}" "${OPENCV_COMMIT}"

# Output invariants
# -----------------
# Checked on the host, not in the container: what is checked is the file on disk, the
# same one users get. Both directions are checked — checking one side assumes the other
# cannot go wrong. A wrong variant, upstream changing the SINGLE_FILE inversion, or
# build_js.py moving its output all fail here, right away, instead of surfacing in
# assemble or at runtime.
GLUE="${OUT_DIR}/${BUILD_SUBDIR}/opencv.js"
WASM="${OUT_DIR}/${BUILD_SUBDIR}/opencv_js.wasm"
GLUE_SIZE=$(wc -c < "${GLUE}" | tr -d '[:space:]')

if [[ "${SINGLE_FILE}" == "1" ]]; then
  if (( GLUE_SIZE <= INLINE_THRESHOLD )); then
    echo "❌ The single-file variant's opencv.js is only ${GLUE_SIZE} bytes (<= ${INLINE_THRESHOLD}):" >&2
    echo "   SINGLE_FILE=1 had no effect and the wasm was not embedded." >&2
    exit 1
  fi
  if [[ -e "${WASM}" ]]; then
    echo "❌ The single-file variant should have no separate opencv_js.wasm, but it exists: ${WASM}" >&2
    exit 1
  fi
else
  if [[ ! -f "${WASM}" ]]; then
    echo "❌ ${WASM} is missing; did --disable_single_file have no effect?" >&2
    exit 1
  fi
  if (( GLUE_SIZE > INLINE_THRESHOLD )); then
    echo "❌ ${GLUE} is ${GLUE_SIZE} bytes (> ${INLINE_THRESHOLD}); the wasm may still be embedded in the JS" >&2
    exit 1
  fi
fi

echo "==> Output:"
ls -la "${OUT_DIR}/${BUILD_SUBDIR}"
