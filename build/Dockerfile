# Pins the emsdk version, by tag and by image digest.
#
# 6.0.12 (released 2026-10-08, the latest when this was written). Compatibility points
# checked when upgrading from 3.1.64, all verifiable in the upstream sources:
# - Since Emscripten 4.0.20 Embind requires C++17, and OpenCV's modules/js/CMakeLists.txt
#   stops with FATAL_ERROR when CMAKE_CXX_STANDARD is unset or below 17. OpenCV 5.0.0's
#   cmake/OpenCVDetectCXXCompiler.cmake defaults to ocv_update(CMAKE_CXX_STANDARD 17),
#   so build_js.py configures without extra arguments (the build log says
#   "C++ standard: 17"). The old reason for staying below 4.0.20 only applied to
#   OpenCV 4.x, which defaults to C++11.
# - Since Emscripten 4.0.7 the HEAP8 etc. views are not exported by default, and the
#   extension layer addresses the heap through them:
#   build/patches/opencv-js-link-flags.patch exports them for opencv_js, together with
#   other runtime symbols that are no longer exported by default (see that file).
# - Since Emscripten 4.0.0 --post-js runs after the runtime has initialized, so the hook
#   in OpenCV's helpers.js that replaces the shallow clone() with mat_clone never fires:
#   build/patches/opencv-js-deep-clone.patch fixes that.
# - build_js.py still passes the legacy setting USE_PTHREADS=0, which 6.0.12's
#   tools/settings.py still accepts (LEGACY_SETTINGS) with a deprecation warning.
# When changing this version: rebuild all three variants with the new image, run the
# smoke test and the variant parity test, and re-check the points listed in the
# CHANGELOG entry for the 3.1.64 → 6.0.12 upgrade (exported symbols, the shape of an
# abort, deep clone()). Update the digest together with the tag.
FROM emscripten/emsdk:6.0.12@sha256:77638e6c215a65f25a704c0c831d5c2463a8c0468a58c6cb82489dbe621dfa05

# The emscripten/emsdk image already has python3, git and cmake (its stage_deploy layer),
# so nothing is installed here. Check that all three exist if the base image ever changes.

WORKDIR /work
