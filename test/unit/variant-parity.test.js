"use strict";

// **Numerical agreement** between the baseline and simd variants.
//
// Why this exists
// ---------------
// "The SIMD build runs" and "the SIMD build computes the right thing" are different
// claims. CI runs the whole suite again on the SIMD variant with OPENCV_SIMD=1, which
// shows that the same assertions hold on both variants. This file covers the other half:
// it feeds the same input to both artifacts and compares the outputs element by element.
// Only this catches outputs that differ while each stays within an assertion's tolerance.
//
// That is the one real risk of -msimd128: SIMD kernels are separate hand-written code,
// not the same branch as the scalar path.
//
// Why child processes
// -------------------
// The two variants cannot be loaded in one process: OpenCV's UMD wrapper leaks Module as
// an implicit global, and the second variant collides with the first one's Embind
// registry. The mechanism, the measurements and the alternatives are described at the
// top of test/variant-cases.js.
//
// Skipping and requiring
// ----------------------
// A local dist/ may have baseline only (e.g. only that artifact was downloaded from CI),
// in which case the whole file is skipped. Where both variants are supposed to exist,
// skipping must become a failure: OPENCV_PARITY_REQUIRED=1, the same pattern as
// OPENCV_SMOKE_REQUIRED in test/smoke/wasm-artifact.test.js. A gate that reports green
// without checking anything is worse than no gate.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { DIST } = require("../helpers");
const { CASES } = require("../variant-cases");

const RUNNER = path.join(__dirname, "..", "variant-cases.js");
const SIMD_GLUE = path.join(DIST, "simd", "opencv.js");
const HAS_SIMD = fs.existsSync(SIMD_GLUE);

if (!HAS_SIMD && process.env.OPENCV_PARITY_REQUIRED === "1") {
  throw new Error(
    `OPENCV_PARITY_REQUIRED=1 but ${SIMD_GLUE} does not exist. Variant parity is the ` +
      `only guarantee that the SIMD build computes correctly; skipping it silently ` +
      `checks nothing. Run npm run assemble <baseline dir> <simd dir> first.`,
  );
}

const skip = HAS_SIMD
  ? false
  : "dist/simd/ does not exist (local builds usually have baseline only)";

// The criterion for floating-point cases
// --------------------------------------
//
//     max|a − b|  <=  TOL × max(‖baseline‖∞, 1)
//
// i.e. **an absolute difference normalized by the magnitude of the whole output**, not a
// per-element relative difference. Both the formula and the constant come from OpenCV's
// own test framework:
//
//   modules/imgproc/test/test_filter.cpp
//     CV_PyramidBaseTest::get_success_error_level() → 1e-5 for CV_32F
//     CV_PyramidBaseTest : CV_FilterBaseTest, whose constructor sets
//     element_wise_relative_error = false
//   modules/ts/src/ts_func.cpp  cmpEps()
//     if (refarr.depth() >= CV_32F && !element_wise_relative_error)
//         maxval = norm(refarr, NORM_INF);  maxval = MAX(maxval, 1.);
//     ...
//     threshold = element_wise_relative_error ? fabs(b_val) + 1 : maxval;
//     if (fabs(a_val - b_val) > threshold * success_err_level) → failure
//
// Upstream success_err_level for the same family of operations (all with
// element_wise_relative_error = false): pyrDown / blur / GaussianBlur 1e-5, filter2D
// 1e-4, Sobel 5e-4. This file uses **1e-5**, the strictest of them, for everything — at
// least as strict as upstream for every operation in the table, so per-operation levels
// could only loosen it.
//
// Why not a per-element relative difference (this was once wrong)
// ---------------------------------------------------------------
// This file first used |a−b| / max(|a|,|b|,1e-6), with a comment saying it "allows one or
// two ulp in the last place". On the first real SIMD build (run 30379642633) it reported
// a 7.00e-5 deviation on pyrDown 32FC4, which looked like 752 ulp — two orders of
// magnitude above "one or two ulp".
//
// The **criterion was wrong, not SIMD**. Quantitative analysis on the real artifacts
// (recomputing pyrDown's 5×5 kernel [1,4,6,4,1]/16 with BORDER_REFLECT_101 in double as
// the reference and comparing both variants element by element):
//
//   the failing element, idx 2104
//     baseline            0.010001882910728455
//     simd                0.010001182556152344
//     double reference    0.010000599548220634   ← the same 5×5 kernel accumulated in double
//     |baseline − ref| = 1.283e-6      |simd − ref| = 5.830e-7
//   The magnitude during accumulation for that pixel is Σ|w·x| = 47.80, while the output
//   is only 0.010 — **the output is 0.021% of the accumulated magnitude, an almost
//   complete cancellation.**
//
// The error arises at a magnitude of ~47.8 but was divided by 0.01 — a denominator 4800
// times too small — which inflated 1.6 ulp into "752 ulp". Measured against the
// accumulated magnitude, the largest errors are 1.9 ulp (baseline) and 1.6 ulp (simd):
// exactly the "one or two ulp" the old comment claimed.
//
// The correlation holds too: among the 10 elements with the largest deviation under the
// old criterion, the median cancellation ratio is 0.121%, against 19.128% over all
// elements. **The old criterion picked exactly the points with the most cancellation.**
//
// And SIMD is **closer to the reference** on every aggregate measure, not further away:
//   RMS error                  baseline 1.199e-6   simd 9.721e-7
//   elements closer to ref     baseline 1111       simd 1544 (1441 tied)
//   largest error (ulp)        baseline 1.9        simd 1.6
// A numerically broken implementation would drift systematically away from the double
// reference; here the direction is the opposite.
//
// Conclusion: the pyrDown difference is ordinary floating-point scatter from a different
// accumulation order, with SIMD slightly better. The criterion was replaced by upstream's
// rather than loosening the old threshold, which would have turned "SIMD is not wrong"
// into "SIMD is not too wrong".
//
// Known weakness of this criterion
// --------------------------------
// The denominator is ‖·‖∞ of the whole output, so for operations with a very large
// output dynamic range (e.g. a DFT whose DC term dwarfs the high frequencies) small
// elements pass even with a large relative error. Upstream has the same property. The
// inputs here are fixed in [−100, 100), the outputs range from O(1) to O(10³), and the
// `MAX(maxval, 1.)` floor never applies. Tightening it would take a double-precision
// reference implementation per operation, which costs far more than it gains: the main
// parity guarantee is the whole suite running on both variants, and this file
// supplements it rather than replacing it.
const TOL = 1e-5;

// Time limit per child process. execFileSync is synchronous and blocks the event loop,
// so the test's own timeout (node:test implements it with a timer) cannot fire until it
// returns: a hung child (e.g. stuck wasm initialization) would hang the suite until the
// CI job's hard limit. The limit therefore sits on execFileSync, which kills the child
// itself. The two variants run one after the other; 80 s × 2 is still within the test's
// 180 s.
const CHILD_TIMEOUT_MS = 80000;

test(
  "the two variants' wasm binaries really differ (--simd was not silently dropped)",
  { skip },
  (t) => {
    const sha = (p) =>
      crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const baseWasm = path.join(DIST, "baseline", "opencv_js.wasm");
    const simdWasm = path.join(DIST, "simd", "opencv_js.wasm");

    t.diagnostic(
      `baseline ${fs.statSync(baseWasm).size} B / simd ${fs.statSync(simdWasm).size} B`,
    );
    // A **necessary, not sufficient** condition: different binaries do not prove that
    // v128 instructions are inside (that takes a full wasm parse, beyond this test). It
    // does stop the most realistic failure — --simd renamed, removed or silently ignored
    // upstream, both build paths producing identical bytes, and every assertion still
    // green while the report claims "SIMD variant verified".
    assert.notStrictEqual(
      sha(baseWasm),
      sha(simdWasm),
      "baseline and simd opencv_js.wasm are byte-identical; --simd most likely had no effect",
    );
  },
);

test(
  "the baseline and simd variants produce the same output",
  { skip, timeout: 180000 },
  async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencvjs-parity-"));
    const out = {};
    try {
      for (const v of ["baseline", "simd"]) {
        const f = path.join(tmp, `${v}.json`);
        execFileSync(process.execPath, [RUNNER, v, f], {
          stdio: ["ignore", "inherit", "inherit"],
          env: { ...process.env, OPENCV_DIST: DIST },
          timeout: CHILD_TIMEOUT_MS,
          killSignal: "SIGKILL",
        });
        out[v] = JSON.parse(fs.readFileSync(f, "utf8"));
      }

      // Evaluate every case first and assert once at the end.
      //
      // Not throwing on the first failing case: on the first real SIMD build pyrDown
      // threw first, so Sobel, dft and the two extension-layer cases after it never ran,
      // and the report could not say whether the remaining operations were all fine or
      // broken too — exactly what is needed to tell "one operation's floating-point
      // scatter" from "SIMD is broken". Collecting first shows the whole picture at once.
      const failures = [];
      for (const c of CASES) {
        const a = out.baseline[c.name];
        const b = out.simd[c.name];
        assert.ok(
          Array.isArray(a) && Array.isArray(b),
          `${c.name}: result missing`,
        );
        assert.strictEqual(
          a.length,
          b.length,
          `${c.name}: output lengths differ`,
        );
        assert.ok(
          a.length > 0,
          `${c.name}: empty output; this case tests nothing`,
        );

        let maxAbs = 0;
        let at = -1;
        let normInf = 0;
        let nDiff = 0;
        for (let i = 0; i < a.length; i += 1) {
          if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
            failures.push(
              `${c.name}: element ${i} is not finite, baseline=${a[i]} simd=${b[i]}`,
            );
            at = -2;
            break;
          }
          const d = Math.abs(a[i] - b[i]);
          if (d !== 0) nDiff += 1;
          if (d > maxAbs) {
            maxAbs = d;
            at = i;
          }
          const m = Math.abs(a[i]);
          if (m > normInf) normInf = m;
        }
        if (at === -2) continue;

        if (c.exact) {
          // Integer kernels and the extension layer: there is no rounding, so any
          // difference is a bug.
          if (maxAbs !== 0) {
            failures.push(
              `${c.name}: element ${at} differs, baseline=${a[at]} simd=${b[at]} (this case must be bit-identical)`,
            );
          }
          continue;
        }

        const threshold = TOL * Math.max(normInf, 1);
        // Print the numbers whether or not the case passes: "bit-identical" and "differs
        // by 1.3e-7" are different facts, and a bare "pass" would lose them. Being
        // bit-identical is an accident of the build (on the first real 2.1.0 build, 12 of
        // 14 cases were), so it is reported, not asserted — if it changes, the CI log
        // shows it without failing.
        t.diagnostic(
          `${c.name}: ${nDiff === 0 ? "bit-identical" : `${nDiff}/${a.length} elements differ`}` +
            `  max|a-b|=${maxAbs.toExponential(2)}` +
            `  ‖ref‖∞=${normInf.toExponential(2)}` +
            `  criterion=${(maxAbs / Math.max(normInf, 1)).toExponential(2)}` +
            `  threshold=${TOL.toExponential(0)}` +
            (maxAbs > 0
              ? `  margin ${(threshold / maxAbs).toFixed(0)}x`
              : "  margin ∞"),
        );
        if (maxAbs > threshold) {
          failures.push(
            `${c.name}: max|a-b| = ${maxAbs.toExponential(3)} exceeds ` +
              `${TOL} × max(‖ref‖∞,1) = ${threshold.toExponential(3)}` +
              ` (largest difference at element ${at}, baseline=${a[at]} simd=${b[at]})`,
          );
        }
      }

      assert.deepStrictEqual(
        failures,
        [],
        `the variants' outputs disagree (${failures.length} case(s)):\n  ${failures.join("\n  ")}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
