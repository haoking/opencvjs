#!/usr/bin/env bash
# Assembles the wasm artifacts and the hand-written extension layer into a publishable
# dist/.
#
# Usage: build/assemble.sh [baseline artifact dir] [simd artifact dir]
#
#   baseline defaults to $OPENCV_ARTIFACT_BASELINE, then build/out/baseline
#   simd     defaults to $OPENCV_ARTIFACT_SIMD, then build/out/simd
#   (baseline used to read $OPENCV_ARTIFACT, the smoke test's "artifact under test"
#   variable. Assembling after exporting it to smoke-test the simd variant put the SIMD
#   wasm into dist/baseline/, so the forced-baseline test run actually tested simd.)
#   (These are where build/build.sh and build/build.sh --simd write, and the directories
#   the two build-wasm.yml artifacts unpack to.)
#
# Result:
#   dist/baseline/opencv.js + opencv_js.wasm   the non-SIMD fallback (required)
#   dist/simd/opencv.js     + opencv_js.wasm   the -msimd128 build (optional, see below)
#   dist/index.js         package entry: detect SIMD → load that variant → attach the
#                         extensions → resolve to cv
#   dist/{simd-detect,guards,typed-access,mat-region,arithmetic,dft}.js
#   dist/index.d.ts       TypeScript declarations, dumped by build/gen-types.js from **the
#                         artifacts just assembled** (not hand-written); see that file
#
# The two variants must be in **separate directories**. The wasm file name the glue
# refers to is the compile-time string "opencv_js.wasm" (see the long comment at the top
# of build/build.sh), so both variants' wasm files have the same name: one directory
# would make them overwrite each other, and renaming gives a 404 at runtime. Each
# subdirectory holds its own glue, paired as is with the .wasm next to it — under Node
# the glue finds the .wasm through __dirname.
#
#   This comment once said "the two variants' glue files differ too and cannot be
#   shared". That was **wrong**: the two glue files are byte-identical (SHA-256 da1f9d19…
#   for both on 4.14.0, 33711c08… on 5.0.0, 7cfeb63e… on 5.0.0 built with emsdk 6.0.12).
#   The .wasm name is the only reason for separate directories. Do not rely on the glue
#   files always being identical either — nothing guarantees it.
#
#   The extension layer (index.js and friends) stays at the top of dist/: it is plain JS
#   independent of the variant, and the relative paths in src/js/index.js
#   (require("./baseline/opencv.js")) are written for this layout.
#
# Environment:
#   OPENCV_REQUIRE_SIMD=1   A missing simd artifact becomes an error instead of a
#                           warning. CI must set it: that pipeline is supposed to have both
#                           variants, a missing one means a matrix job went wrong, and
#                           assembling a baseline-only dist/ that still reports green would
#                           be another lying green light. Leave it unset locally to
#                           assemble baseline only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_SRC="${1:-${OPENCV_ARTIFACT_BASELINE:-${REPO_ROOT}/build/out/baseline}}"
SIMD_SRC="${2:-${OPENCV_ARTIFACT_SIMD:-${REPO_ROOT}/build/out/simd}}"
DIST_DIR="${REPO_ROOT}/dist"

# A glue file over 2 MB means --disable_single_file had no effect and the wasm was
# embedded in it. Same threshold as build/build.sh and test/smoke/wasm-artifact.test.js.
INLINE_THRESHOLD=$((2 * 1024 * 1024))

# Checks one variant's artifact directory: both files present, no wasm embedded in the glue.
check_variant() {
  local dir="$1" name="$2" f size
  for f in opencv.js opencv_js.wasm; do
    if [[ ! -f "${dir}/${f}" ]]; then
      echo "❌ The ${name} variant lacks ${dir}/${f}" >&2
      return 1
    fi
  done
  size=$(wc -c < "${dir}/opencv.js" | tr -d '[:space:]')
  if (( size > INLINE_THRESHOLD )); then
    echo "❌ ${dir}/opencv.js is ${size} bytes (> ${INLINE_THRESHOLD}); the wasm may still be embedded in the JS" >&2
    echo "   The single-file variant is not part of the npm package; do not pass it to this script." >&2
    return 1
  fi
  return 0
}

if [[ ! -d "${BASELINE_SRC}" ]]; then
  echo "❌ The baseline artifact directory does not exist: ${BASELINE_SRC}" >&2
  echo "   Run build/build.sh, unpack the CI artifact there, or pass the directory as the first argument." >&2
  exit 1
fi
check_variant "${BASELINE_SRC}" baseline

# simd is optional: a local checkout may have the baseline artifact only (e.g. only that
# one was downloaded from CI), and assembling a dist/ that can run the tests must still
# work. Without it dist/simd/ simply does not exist and runtime detection falls back to
# baseline with a warning (see src/js/index.js). Baseline is **not** copied in as a fake
# simd: "run everything with forced SIMD" would then test baseline.
HAS_SIMD=0
if [[ -d "${SIMD_SRC}" ]]; then
  check_variant "${SIMD_SRC}" simd
  HAS_SIMD=1
elif [[ "${OPENCV_REQUIRE_SIMD:-}" == "1" ]]; then
  echo "❌ OPENCV_REQUIRE_SIMD=1 but the simd artifact directory does not exist: ${SIMD_SRC}" >&2
  exit 1
else
  echo "⚠️  The simd artifact directory does not exist: ${SIMD_SRC}"
  echo "    dist/ will hold baseline only; runtime detection falls back to baseline, and OPENCV_SIMD=1 fails."
fi

# Rebuild from scratch, so nothing stale survives from the previous assembly (a module
# deleted since, or a dist/simd/ from the last run that this run does not have).
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/baseline"

cp "${BASELINE_SRC}/opencv.js" "${BASELINE_SRC}/opencv_js.wasm" "${DIST_DIR}/baseline/"
if (( HAS_SIMD )); then
  mkdir -p "${DIST_DIR}/simd"
  cp "${SIMD_SRC}/opencv.js" "${SIMD_SRC}/opencv_js.wasm" "${DIST_DIR}/simd/"
fi
cp "${REPO_ROOT}"/src/js/*.js "${DIST_DIR}/"

# The .d.ts must be generated here, from the artifacts just copied: its content is a dump
# of Object.keys(cv). Any "generate first, swap artifacts later" order would let the
# declarations drift from the runtime, the very problem this project fixes. A generator
# failure fails the whole assembly (set -e); a stale declaration file must never end up
# in dist/.
#
# gen-types.js always loads with { simd: false } (see the comment at its main()).
node "${REPO_ROOT}/build/gen-types.js" "${DIST_DIR}"

echo "==> dist/:"
ls -la "${DIST_DIR}"
for v in baseline simd; do
  # An if rather than `[[ ... ]] && ls`: without dist/simd/ the AND-list exits 1, and as
  # the last command of the script under set -e it would make a perfectly good
  # baseline-only assembly fail.
  if [[ -d "${DIST_DIR}/${v}" ]]; then
    ls -la "${DIST_DIR}/${v}"
  fi
done
