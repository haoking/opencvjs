"use strict";

/**
 * Entry point of @haoking/opencvjs.
 *
 * Loads the Emscripten glue, attaches the extension layer to cv.Mat.prototype and cv,
 * and resolves to the ready cv object:
 *
 *   const cv = await require("@haoking/opencvjs")();                 // detect SIMD
 *   const cv = await require("@haoking/opencvjs")({ simd: false });  // force baseline
 *
 * dist/ ships two wasm builds, each in its own directory:
 *
 *   dist/baseline/opencv.js + opencv_js.wasm   no SIMD, runs everywhere
 *   dist/simd/opencv.js     + opencv_js.wasm   compiled with -msimd128
 *
 * They have to live in separate directories: the glue has the wasm file name
 * "opencv_js.wasm" baked in at compile time (see build/build.sh) and finds it next to
 * itself, so the two .wasm files cannot share a directory or be renamed. The two glue
 * files happen to be byte-identical, but nothing guarantees that.
 *
 * Variant selection: loadOpenCV({ simd })  >  OPENCV_SIMD  >  runtime detection (see
 * resolveVariant() in ./simd-detect.js). A variant that was asked for explicitly and is
 * missing throws; only automatic selection falls back to baseline. Once a variant is
 * loaded, asking for the other one throws and automatic selection reuses the loaded one
 * (see the comment at the top of loadOpenCV()).
 *
 * Readiness is `typeof cv.Mat === "function"`. The glue's require() returns a promise;
 * do not wait for cv.onRuntimeInitialized — artifacts built with emsdk 3.1.64 still had
 * that property after the promise resolved, so waiting on it never ended.
 */

const applyGuards = require("./guards");
const applyTypedAccess = require("./typed-access");
const applyMatRegion = require("./mat-region");
const applyArithmetic = require("./arithmetic");
const applyDft = require("./dft");
const { detectSimd, resolveVariant } = require("./simd-detect");

/**
 * Both requires use literal paths so bundlers (webpack, rollup, esbuild) can see both
 * dependencies statically and ship both variants; a computed path such as
 * `require("./" + variant + "/opencv.js")` leaves them guessing.
 */
function requireGlue(variant) {
  return variant === "simd"
    ? require("./simd/opencv.js")
    : require("./baseline/opencv.js");
}

/**
 * True only when the glue file itself was not found. Checking e.code alone is not
 * enough: a require that fails inside the glue raises MODULE_NOT_FOUND too, and
 * swallowing that as "variant missing" would silently switch to baseline. Node's
 * message carries the exact specifier ("Cannot find module './simd/opencv.js'"); a
 * nested failure names a different module.
 */
function isGlueMissing(e, variant) {
  return Boolean(
    e &&
    e.code === "MODULE_NOT_FOUND" &&
    typeof e.message === "string" &&
    e.message.includes(`./${variant}/opencv.js`),
  );
}

/** Who asked for the variant, for error messages. */
function whoAsked(choice) {
  return choice.source === "option"
    ? `loadOpenCV({ simd: ${choice.variant === "simd"} })`
    : "the environment variable OPENCV_SIMD";
}

let warnedSimdFallback = false;

/** The variant this process has loaded, or null before the first load. */
let loadedVariant = null;

module.exports = async function loadOpenCV(options) {
  const choice = resolveVariant(options);
  let variant = choice.variant;

  // One variant per process. OpenCV's UMD wrapper leaks Module as an implicit global,
  // so requiring the second variant's glue first writes its JS helpers onto the loaded
  // instance (cv.matFromArray gets replaced and loses its length check) and only then
  // fails in Embind with "Cannot register public name 'IntVector' twice". Hence the
  // check before any require:
  //   - the other variant was named (options / OPENCV_SIMD): throw, leaving the loaded
  //     instance intact;
  //   - automatic selection: falling back is allowed anyway, and reusing the loaded
  //     variant is the only option that works.
  if (loadedVariant !== null && variant !== loadedVariant) {
    if (choice.source === "probe") {
      variant = loadedVariant;
    } else {
      throw new Error(
        `${whoAsked(choice)} asks for the ${variant} variant, but this process has already ` +
          `loaded the ${loadedVariant} variant.\nOnly one variant can be loaded per process: ` +
          `the second variant's glue rewrites the loaded instance before Embind registration ` +
          `fails. To compare the variants, use two processes (as test/simd-compare.js does).`,
      );
    }
  }

  let glue;
  try {
    glue = requireGlue(variant);
  } catch (e) {
    if (choice.source !== "probe") {
      // A variant that was named explicitly is missing: throw, never substitute. If
      // "run the tests with OPENCV_SIMD=1" quietly ran baseline, the green result would
      // be a lie, and the baseline/SIMD parity tests rely on exactly this.
      throw new Error(
        `${whoAsked(choice)} explicitly asks for the ${variant} variant, but ` +
          `dist/${variant}/opencv.js failed to load: ${(e && e.message) || e}\n` +
          `Not falling back to the other variant: "force ${variant}" must not quietly ` +
          `run something else.\nBuild it with build/build.sh${variant === "simd" ? " --simd" : ""}, ` +
          `then npm run assemble.`,
        { cause: e },
      );
    }
    if (variant !== "simd" || !isGlueMissing(e, "simd")) {
      throw e;
    }
    // Automatic selection and the SIMD variant really is missing: fall back to baseline,
    // which always ships — but say so. The published package has both variants, so this
    // only happens with a local baseline-only assembly or a bundler that dropped
    // dist/simd/, and either way nobody should believe they are running SIMD.
    if (!warnedSimdFallback) {
      warnedSimdFallback = true;
      console.warn(
        "[@haoking/opencvjs] The engine supports SIMD but dist/simd/opencv.js is missing; " +
          "falling back to baseline. (Set OPENCV_SIMD=0 to choose baseline explicitly " +
          "and silence this warning.)",
      );
    }
    variant = "baseline";
    glue = requireGlue(variant);
  }
  loadedVariant = variant;

  const cv = await glue;

  if (typeof cv.Mat !== "function") {
    throw new Error(
      `The OpenCV wasm runtime is not ready (variant ${variant}): cv.Mat is not a ` +
        `constructor. Do not use cv.onRuntimeInitialized to detect readiness.`,
    );
  }

  // guards first: it builds its tables from cv's type constants and wraps
  // cv.matFromArray; the modules below use the validators it returns.
  const guards = applyGuards(cv);

  // access.pixels() lets the per-pixel loops read and write the wasm heap directly; their
  // index ranges are validated once on entry instead of per pixel (see typed-access.js).
  const access = applyTypedAccess(cv, guards);

  applyMatRegion(cv, guards, access);
  applyArithmetic(cv, guards);
  applyDft(cv, guards);

  return cv;
};

/**
 * Whether the engine supports WebAssembly SIMD — the first thing to check when looking
 * into performance. It reports the engine's capability, not which variant was loaded:
 * with OPENCV_SIMD=0 the engine still supports SIMD while baseline is loaded.
 */
module.exports.detectSimd = detectSimd;
