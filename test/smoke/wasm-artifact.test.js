"use strict";

// Smoke test for a freshly built wasm artifact; build-wasm.yml runs it on every variant.
// OPENCV_ARTIFACT points at the artifact directory.
//
// Without OPENCV_ARTIFACT it skips, so a plain `npm test` does not fail on machines that
// have no artifact. Where an artifact must exist the skip has to become a failure: this is
// the only check inside the build job, and a skipped `node --test` still exits 0 — a
// misspelt variable or a missing directory would let the whole build go green unverified.
// The switch is OPENCV_SMOKE_REQUIRED=1, not process.env.CI: GitHub Actions sets CI=true
// for every step, including ci.yml's `npm test`, which globs this file too and has no
// artifact. The build job also runs `test -d "$OPENCV_ARTIFACT"` in the shell first; the
// two guards do not depend on each other.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const artifact = process.env.OPENCV_ARTIFACT;

// The single-file variant inverts the artifact's shape: a single opencv.js with the wasm
// embedded, so the glue must be *larger* than 2 MB. The variant is stated explicitly
// rather than guessed from "is there a .wasm" — guessing would pass a split build that
// lost its .wasm as a single-file one. Same 2 MB threshold as build/build.sh and
// build/assemble.sh.
const SINGLE_FILE = process.env.OPENCV_SMOKE_SINGLE_FILE === "1";
const INLINE_THRESHOLD = 2 * 1024 * 1024;

// Only "1" counts, as with OPENCV_PARITY_REQUIRED: a truthiness check would treat
// OPENCV_SMOKE_REQUIRED=0 as "required".
if (!artifact && process.env.OPENCV_SMOKE_REQUIRED === "1") {
  throw new Error(
    "OPENCV_SMOKE_REQUIRED=1 but OPENCV_ARTIFACT is not set — the smoke test is the " +
      "build's only check and must not be skipped there. Unset both for local runs.",
  );
}

const HEAP_VIEWS = [
  "HEAP8",
  "HEAPU8",
  "HEAP16",
  "HEAPU16",
  "HEAP32",
  "HEAPU32",
  "HEAPF32",
  "HEAPF64",
];
const RUNTIME_FUNCTIONS = [
  "BindingError",
  "InternalError",
  "UnboundTypeError",
  "flushPendingDeletes",
  "setDelayFunction",
  "count_emval_handles",
  "getInheritedInstanceCount",
  "getLiveInheritedInstances",
  "FS_createPreloadedFile",
];

test(
  `smoke test of a freshly built wasm artifact (${SINGLE_FILE ? "single-file" : "split"} variant)`,
  {
    skip: !artifact ? "OPENCV_ARTIFACT is not set (local development)" : false,
    // Instantiation takes seconds. A load that hangs must fail here rather than run into
    // the job's timeout.
    timeout: 60000,
  },
  async () => {
    const jsPath = path.resolve(artifact, "opencv.js");
    const wasmPath = path.resolve(artifact, "opencv_js.wasm");
    assert.ok(fs.existsSync(jsPath), `missing ${jsPath}`);

    const jsSize = fs.statSync(jsPath).size;
    if (SINGLE_FILE) {
      assert.ok(
        !fs.existsSync(wasmPath),
        `the single-file variant must not have a separate ${wasmPath}`,
      );
      assert.ok(
        jsSize > INLINE_THRESHOLD,
        `opencv.js is only ${(jsSize / 1048576).toFixed(1)} MB — SINGLE_FILE=1 did not take effect`,
      );
    } else {
      assert.ok(
        fs.existsSync(wasmPath),
        `missing ${wasmPath} — did --disable_single_file not take effect?`,
      );
      assert.ok(
        jsSize < INLINE_THRESHOLD,
        `opencv.js is ${(jsSize / 1048576).toFixed(1)} MB — the wasm is probably still embedded`,
      );
    }

    // Ready means `typeof cv.Mat === "function"`, never onRuntimeInitialized: artifacts
    // built with emsdk 3.1.64 still carried that property after the promise resolved, and
    // waiting on it hung the first CI build.
    const mod = require(jsPath);
    const cv = typeof mod.then === "function" ? await mod : mod;
    assert.strictEqual(
      typeof cv.Mat,
      "function",
      "cv.Mat is not a constructor after loading — the runtime is not ready",
    );

    const owned = [];
    const own = (obj) => {
      owned.push(obj);
      return obj;
    };
    try {
      const m = own(cv.matFromArray(2, 2, cv.CV_32FC1, [1, 2, 3, 4]));
      assert.strictEqual(m.rows, 2);
      assert.deepStrictEqual(Array.from(m.data32F), [1, 2, 3, 4]);

      // clone() must be a deep copy. Upstream once made it shallow without anyone noticing
      // for a year (opencv/opencv#26643), and on Emscripten >= 4.0.0 upstream's own fix
      // never runs; build/patches/opencv-js-deep-clone.patch restores it.
      const copy = own(m.clone());
      m.data32F[0] = 999;
      assert.strictEqual(copy.data32F[0], 1, "clone() is a shallow copy");

      // Runtime exports added by build/patches/opencv-js-link-flags.patch. The extension
      // layer reads and writes the wasm heap through the HEAP* views.
      for (const name of HEAP_VIEWS) {
        assert.ok(
          ArrayBuffer.isView(cv[name]),
          `missing runtime export cv.${name}`,
        );
      }
      for (const name of RUNTIME_FUNCTIONS) {
        assert.strictEqual(
          typeof cv[name],
          "function",
          `missing runtime export cv.${name}`,
        );
      }

      // The same patch raises the memory ceiling to 2 GB: 1.25 GB is past the old 1 GB
      // cap. The pages are never touched, so this stays cheap.
      const big = own(new cv.Mat(1280, 1024 * 1024, cv.CV_8UC1));
      assert.strictEqual(
        big.rows,
        1280,
        "a 1.25 GB Mat could not be allocated",
      );

      // What emsdk 6.0.12's Embind adds and the README documents: `using` on a Mat
      // (Symbol.dispose is delete) and iterable vectors.
      if (typeof Symbol.dispose === "symbol") {
        assert.strictEqual(
          typeof m[Symbol.dispose],
          "function",
          "Mat has no Symbol.dispose — `using` would not free it",
        );
      }
      const vec = own(new cv.MatVector());
      vec.push_back(m);
      assert.strictEqual(
        typeof vec[Symbol.iterator],
        "function",
        "MatVector is not iterable",
      );
      const items = [...vec];
      owned.push(...items);
      assert.strictEqual(items.length, 1);
      assert.ok(
        items[0] instanceof cv.Mat,
        "iterating a MatVector did not yield Mats",
      );

      // Class bindings the whitelist must keep, across modules: ORB from features, and
      // FaceDetectorYN plus the MCC classes from objdetect (the MCC ones also need
      // build/patches/opencv-js-mcc-bindings.patch). Classes rather than free functions,
      // because Embind registers classes through a separate path (constructor + method
      // table) that free functions do not exercise.
      for (const name of [
        "ORB",
        "FaceDetectorYN",
        "mcc_CCheckerDetector",
        "mcc_CChecker",
        "mcc_DetectorParametersMCC",
      ]) {
        assert.strictEqual(
          typeof cv[name],
          "function",
          `whitelist binding missing: cv.${name}`,
        );
      }

      // Pins the 5.x baseline from the other side: OpenCV 5 removed CascadeClassifier
      // from the C++ API, so seeing it means a 4.x build slipped in.
      assert.strictEqual(
        cv.CascadeClassifier,
        undefined,
        "CascadeClassifier is back — this is probably not a 5.x build",
      );

      // The exact version must match build/opencv-version.txt; otherwise another 5.x
      // release would pass too. test/unit/artifact-version.test.js checks dist/ the same way.
      const wantVersion = fs
        .readFileSync(
          path.join(__dirname, "..", "..", "build", "opencv-version.txt"),
          "utf8",
        )
        .trim();
      const versionLine = /General configuration for OpenCV (\S+)/.exec(
        cv.getBuildInformation(),
      );
      assert.ok(versionLine, "no version line in getBuildInformation()");
      assert.strictEqual(
        versionLine[1],
        wantVersion,
        `the artifact is OpenCV ${versionLine[1]}, but build/opencv-version.txt pins ${wantVersion}`,
      );

      // dnn has no JS bindings. Its C++ code is still compiled in — build_js.py forces
      // -DBUILD_opencv_dnn=ON and the whitelist only controls which bindings are generated.
      assert.strictEqual(
        cv.readNetFromTensorflow,
        undefined,
        "dnn bindings are present",
      );
    } finally {
      for (const obj of owned) if (!obj.isDeleted()) obj.delete();
    }
  },
);
