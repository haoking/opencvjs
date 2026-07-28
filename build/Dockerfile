# 锁死 emsdk 版本 —— 官方 nightly 仍钉在 2019 年的 1.39.0,不可参照。
#
# 选 3.1.64(2024-07 发布)的理由(下面两条都可直接在上游源码里核对,
# 不依赖本仓库任何未提交的文件):
# - 必须 < 4.0.20:emscripten 自 4.0.20 起,Embind 要求 C++17,opencv 的
#   modules/js/CMakeLists.txt 会在 cmake 配置阶段直接 FATAL_ERROR,除非额外
#   传 --cmake_option="-DCMAKE_CXX_STANDARD=17"。3.1.64 在这条线以下,
#   build_js.py 不加任何额外参数就能配置成功。
# - 最好 >= 3.1.54:emscripten 3.1.54 起废弃旧的 DEMANGLE_SUPPORT 链接参数,
#   同一份 CMakeLists.txt 会按版本号跳过它;3.1.64 走的是"无需该参数"的分支。
# 升级此版本号时必须重跑 Task 10 的冒烟测试;若升到 >= 4.0.20,还需通过
# build.sh 的 EXTRA_CMAKE_OPTIONS 环境变量补上 -DCMAKE_CXX_STANDARD=17。
FROM emscripten/emsdk:3.1.64

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 git cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
