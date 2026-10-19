#!/usr/bin/env bash
# Prints a short fingerprint of every input that determines the wasm artifacts.
#
# build-wasm.yml appends it to the artifact names and ci.yml downloads the artifacts whose
# name carries the fingerprint of the commit under test. Tests therefore always run on
# artifacts built from the current build inputs, never on whatever build-wasm last produced
# on some other branch or before the inputs changed.
#
# Usage: build/fingerprint.sh        (works on Linux and macOS)
set -euo pipefail
export LC_ALL=C # fixed glob order, so every machine hashes the patches in the same order

cd "$(dirname "${BASH_SOURCE[0]}")/.."
files=(
  build/Dockerfile
  build/build.sh
  build/opencv-version.txt
  build/opencv-commit.txt
  src/config/opencv_js.config.py
  build/patches/*.patch
)

if command -v sha256sum > /dev/null 2>&1; then
  hash=(sha256sum)
else
  hash=(shasum -a 256)
fi

for f in "${files[@]}"; do
  printf '== %s\n' "$f"
  cat "$f"
done | "${hash[@]}" | cut -c1-16
