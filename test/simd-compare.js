"use strict";

// **Measured** baseline vs simd performance. Usage: npm run simd:compare
//
// This is not a gate and never exits non-zero because an operation got slower: SIMD does
// not win everywhere. Upstream's 2020 per-kernel data has a clear counterexample — blur
// CV_32FC1 at 0.519x, nearly twice as slow as scalar. A "SIMD must be faster" gate would
// force future maintainers to delete the gate or measure only the favourable operations.
// This script only prints the real numbers, ugly ones included.
//
// Nor is it a test/bench/*.bench.js: those are regression gates (thresholds, exit 1), and
// npm run bench runs every file in that directory as a gate. This file sits at the top of
// test/, so neither `npm test` (glob test/*/*.test.js) nor `npm run bench` picks it up.
//
// Needs both variants in dist/; without simd it says so and exits 0.
//
// Why one child process per variant
// ---------------------------------
// The two variants cannot be loaded in one process: OpenCV's UMD wrapper leaks Module as
// an implicit global, and the second variant collides with the first one's Embind
// registry (mechanism and measurements at the top of test/variant-cases.js).
//
// For **timing** that is a good thing, not just a workaround: the warm-up note in
// test/bench/region-ops.bench.js records that "in separate processes the two were almost
// identical", i.e. separate processes are an unbiased comparison. So each variant runs
// ROUNDS rounds in its own process, discards round 1 (the one-time JIT tiering and Embind
// call bridge warm-up) and takes the minimum; the parent runs the two in both start orders
// ([base, simd] and [simd, base]) and takes each variant's minimum over both passes, which
// also cancels machine-state differences from who starts first (page cache, CPU frequency
// ramp-up).
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const path = require("path");

const DIST = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");
const ROUNDS = 4; // round 1 is warm-up and discarded

// Deterministic input. Both variants must get the same data, or they do different work.
// The generators are shared with the variant parity cases (variant-cases.js's
// child-process runner has a require.main guard, so requiring it only takes the exports).
const { bytes, floats } = require("./variant-cases");

// ---------------------------------------------------------------------------
// Cases. setup(cv) builds the input once, op(cv, ctx) runs the operation once, and the
// context is released afterwards.
//
// Chosen as: (1) the four biggest differences in upstream's 2020 per-kernel data (resize
// 8UC4 1.77x / pyrDown 32FC4 3.09x / GaussianBlur 3.36x / blur 32FC1 0.519x — the last is
// the counterexample and must stay); (2) what this project's extension layer actually
// runs (roi + clone, per-pixel writes); (3) a few common element-wise and color
// conversion operations.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: "add 8UC1 256x256",
    iters: 400,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 1)),
      b: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 2)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.add(c.a, c.b, c.d),
  },
  {
    name: "absdiff 8UC3 256x256",
    iters: 300,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC3, bytes(196608, 3)),
      b: cv.matFromArray(256, 256, cv.CV_8UC3, bytes(196608, 4)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.absdiff(c.a, c.b, c.d),
  },
  {
    name: "cvtColor RGBA2GRAY 8UC4 256x256",
    iters: 300,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC4, bytes(262144, 5)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.cvtColor(c.a, c.d, cv.COLOR_RGBA2GRAY),
  },
  {
    name: "resize 8UC4 256x256 -> 128x128 (1.77x upstream)",
    iters: 200,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC4, bytes(262144, 6)),
      d: new cv.Mat(),
      size: new cv.Size(128, 128),
    }),
    op: (cv, c) => cv.resize(c.a, c.d, c.size, 0, 0, cv.INTER_LINEAR),
  },
  {
    name: "GaussianBlur 8UC1 256x256 k=5 (3.36x upstream)",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 7)),
      d: new cv.Mat(),
      k: new cv.Size(5, 5),
    }),
    op: (cv, c) => cv.GaussianBlur(c.a, c.d, c.k, 1.4, 1.4, cv.BORDER_DEFAULT),
  },
  {
    name: "blur 32FC1 256x256 k=5 (0.519x upstream)",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 8)),
      d: new cv.Mat(),
      k: new cv.Size(5, 5),
      anchor: new cv.Point(-1, -1),
    }),
    op: (cv, c) => cv.blur(c.a, c.d, c.k, c.anchor, cv.BORDER_DEFAULT),
  },
  {
    name: "pyrDown 32FC4 256x256 (3.09x upstream)",
    iters: 100,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC4, floats(262144, 9)),
      d: new cv.Mat(),
      z: new cv.Size(0, 0),
    }),
    op: (cv, c) => cv.pyrDown(c.a, c.d, c.z, cv.BORDER_DEFAULT),
  },
  {
    name: "Sobel 32FC1 256x256",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 10)),
      d: new cv.Mat(),
    }),
    op: (cv, c) =>
      cv.Sobel(c.a, c.d, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT),
  },
  {
    name: "dft 32FC1 256x256",
    iters: 60,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_32FC1, floats(65536, 11)),
      d: new cv.Mat(),
    }),
    op: (cv, c) => cv.dft(c.a, c.d, cv.DFT_COMPLEX_OUTPUT, 0),
  },
  {
    name: "warpAffine 8UC1 256x256",
    iters: 150,
    setup: (cv) => ({
      a: cv.matFromArray(256, 256, cv.CV_8UC1, bytes(65536, 12)),
      m: cv.matFromArray(
        2,
        3,
        cv.CV_64FC1,
        [0.94, -0.34, 3.5, 0.34, 0.94, -2.5],
      ),
      d: new cv.Mat(),
      size: new cv.Size(256, 256),
    }),
    op: (cv, c) => cv.warpAffine(c.a, c.d, c.m, c.size),
  },
  {
    name: "roiClone 32x32 of 64x64",
    iters: 20000,
    setup: (cv) => ({
      a: cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 13)),
      r: new cv.Rect(1, 1, 32, 32),
    }),
    op: (cv, c) => {
      const d = c.a.roiClone(c.r);
      d.delete();
    },
  },
  {
    name: "replaceMatOnRect 32x32 into 64x64",
    // With direct heap addressing one call takes about 2 µs; a large count gives each
    // round tens of milliseconds to measure.
    iters: 50000,
    setup: (cv) => ({
      a: cv.matFromArray(64, 64, cv.CV_32FC1, floats(4096, 14)),
      p: cv.matFromArray(32, 32, cv.CV_32FC1, floats(1024, 15)),
      r: new cv.Rect(1, 1, 32, 32),
    }),
    // The signature is replaceMatOnRect(src, rect): source first, rect second.
    op: (cv, c) => c.a.replaceMatOnRect(c.p, c.r),
  },
];

function measure(cv, c, ctx) {
  const t0 = performance.now();
  for (let i = 0; i < c.iters; i += 1) c.op(cv, ctx);
  return performance.now() - t0;
}

function release(ctx) {
  for (const v of Object.values(ctx)) {
    if (v && typeof v.delete === "function") v.delete();
  }
}

// --- Child: measures one variant and writes each case's minimum time as JSON ---
async function child(variant, outFile) {
  const cv = await require(path.join(DIST, "index.js"))({
    simd: variant === "simd",
  });
  const result = {};
  for (const c of CASES) {
    const ctx = c.setup(cv);
    const rounds = [];
    for (let r = 0; r < ROUNDS; r += 1) rounds.push(measure(cv, c, ctx));
    release(ctx);
    // Discard round 1 (warm-up) and take the minimum of the rest. ROUNDS is the constant 4,
    // so slice(1) is never empty; if it is ever set to 1, Math.min() would return Infinity,
    // which is stopped here.
    const kept = rounds.slice(1);
    if (kept.length === 0) {
      throw new Error(
        `ROUNDS must be >= 2 (it is ${ROUNDS}): round 1 is warm-up`,
      );
    }
    result[c.name] = Math.min(...kept);
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

// --- Parent: one pass in each start order, each variant's minimum of both passes ---
// Child time limit. execFileSync is synchronous, so a hung child would hang the parent;
// the limit sits on the call, which kills the child itself. A variant normally finishes
// in about ten seconds; 10 minutes only guards against hangs.
const CHILD_TIMEOUT_MS = 10 * 60 * 1000;

function runChild(variant, tmp, tag) {
  const f = path.join(tmp, `${variant}-${tag}.json`);
  execFileSync(process.execPath, [__filename, variant, f], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, OPENCV_DIST: DIST },
    timeout: CHILD_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function parent() {
  const simdGlue = path.join(DIST, "simd", "opencv.js");
  if (!fs.existsSync(simdGlue)) {
    console.log(
      `⚠️  ${simdGlue} does not exist; there is no SIMD variant to compare.`,
    );
    console.log(
      "    Run build/build.sh --simd (needs Docker), then npm run assemble <baseline> <simd>.",
    );
    return;
  }

  console.log(`node ${process.version} / ${process.platform}-${process.arch}`);
  console.log(
    `one child process per variant, ROUNDS=${ROUNDS} (first round discarded, minimum taken), one pass in each start order\n`,
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencvjs-simdcmp-"));
  let a1, s1, s2, a2;
  try {
    a1 = runChild("baseline", tmp, "p1");
    s1 = runChild("simd", tmp, "p1");
    s2 = runChild("simd", tmp, "p2");
    a2 = runChild("baseline", tmp, "p2");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(
    "operation".padEnd(46) +
      "baseline".padStart(11) +
      "simd".padStart(11) +
      "speedup".padStart(10),
  );
  console.log("-".repeat(78));

  const rows = [];
  for (const c of CASES) {
    const b = Math.min(a1[c.name], a2[c.name]);
    const s = Math.min(s1[c.name], s2[c.name]);
    const ratio = b / s; // > 1 means SIMD is faster
    rows.push({ name: c.name, b, s, ratio });
    console.log(
      c.name.padEnd(46) +
        `${b.toFixed(1)} ms`.padStart(11) +
        `${s.toFixed(1)} ms`.padStart(11) +
        `${ratio.toFixed(2)}x`.padStart(10),
    );
  }

  const slower = rows.filter((r) => r.ratio < 1);
  console.log("-".repeat(78));
  console.log(
    `${rows.length} operations: SIMD faster on ${rows.length - slower.length}, slower on ${slower.length}.`,
  );
  if (slower.length) {
    console.log(
      "Slower with SIMD (not a bug; a fact that has to be recorded):",
    );
    for (const r of slower) {
      console.log(`  ${r.name}  ${r.ratio.toFixed(2)}x`);
    }
  }
  // Deliberately no exit(1): see the top of the file.
}

async function main() {
  const variant = process.argv[2];
  if (variant === "baseline" || variant === "simd") {
    const outFile = process.argv[3];
    if (!outFile) throw new Error("child mode needs an output JSON path");
    await child(variant, outFile);
    return;
  }
  if (variant !== undefined) {
    throw new Error(
      `unknown argument ${variant} (this script takes no arguments; child mode is invoked by the script itself)`,
    );
  }
  parent();
}

main().catch((e) => {
  console.error(`❌ the comparison could not run: ${(e && e.message) || e}`);
  process.exit(1);
});
