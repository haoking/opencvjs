"use strict";

const fs = require("fs");
const path = require("path");

/**
 * The code under test is the **assembled dist/**, i.e. what users get from
 * `npm install`: the CI-built wasm artifacts (opencv.js glue + opencv_js.wasm) plus the
 * extension layer from src/js/. src/js/index.js is not required directly: src/ has no
 * glue next to it, so require("./opencv.js") would fail, and testing src/ would skip the
 * assembly step.
 *
 * dist/ is not in git (.gitignore); generate it with `npm run assemble` first.
 * OPENCV_DIST can point at a dist layout elsewhere (e.g. a directory downloaded from CI).
 */
const DIST = process.env.OPENCV_DIST || path.join(__dirname, "..", "dist");

/**
 * The extension layer in dist/ must be byte-identical to src/js/, or everything fails
 * right away.
 *
 * The tests run dist/, and dist/ is only copied from src/js/ by npm run assemble. Edit
 * src/js/, forget to assemble, and the whole suite stays green on the **old code**. So
 * this compares them before any test starts (every test file and gate requires this
 * module). Outside the repository (no src/js/) there is nothing to compare, and the
 * check is skipped.
 */
function assertDistMatchesSource() {
  const srcDir = path.join(__dirname, "..", "src", "js");
  if (!fs.existsSync(srcDir)) return;
  const stale = fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => {
      const built = path.join(DIST, name);
      return (
        !fs.existsSync(built) ||
        !fs.readFileSync(built).equals(fs.readFileSync(path.join(srcDir, name)))
      );
    });
  if (stale.length > 0) {
    throw new Error(
      `${DIST} is out of sync with src/js/ (${stale.join(", ")}); run npm run assemble ` +
        `first, or the tests run the code from the last assembly`,
    );
  }
}
assertDistMatchesSource();

const DEPTHS = ["8U", "8S", "16U", "16S", "32S", "32F", "64F"];
const CHANNELS = [1, 2, 3, 4];

let cached = null;

/**
 * Loads and caches cv.
 *
 * The artifact's entry returns a Promise. On artifacts built with emsdk 3.1.64,
 * `cv.onRuntimeInitialized` **still exists** after the await (typeof "function"), so
 * using it as the readiness test is always true and waits for a callback that never
 * fires again — the first CI smoke test failed exactly that way. 6.0.12 builds no longer
 * leave it behind, but readiness is still judged by cv.Mat alone.
 *
 * A missing dist/ **throws instead of skipping**: skipping would silently drop the suite
 * from a few hundred tests to 0 with exit code 0, the failure mode this repository keeps
 * removing.
 */
async function getCv() {
  if (cached) return cached;

  const entry = path.join(DIST, "index.js");
  let loadCV;
  try {
    loadCV = require(entry);
  } catch (e) {
    throw new Error(
      `Cannot load ${entry}: ${describeError(e)}\n` +
        `dist/ is assembled by build/assemble.sh and is not in git. Run:\n` +
        `  npm run assemble [wasm artifact directory]\n` +
        `(the artifact directory defaults to build/out/baseline, where build/build.sh writes)`,
    );
  }

  const cv = await loadCV();
  if (typeof cv.Mat !== "function") {
    throw new Error(
      "cv.Mat is not a constructor; the wasm runtime is not ready",
    );
  }
  cached = cv;
  return cv;
}

/**
 * Builds whose exception catching is compiled out can throw a number (e.g. 6446944)
 * instead of an Error. Reading e.message then gives undefined, and a string operation on
 * it crashes the test code itself, disguised as "the cv module is broken". Every catch
 * site must go through this function.
 *
 * When e is an object with a message property, the message is used whatever its type
 * ({message: 123} gives "123" rather than String(e)'s "[object Object]"); otherwise
 * String(e), which covers numbers, strings, null, undefined and other non-object throws.
 * Both branches return a string and never throw.
 */
function describeError(e) {
  if (e !== null && typeof e === "object" && e.message !== undefined) {
    return String(e.message);
  }
  return String(e);
}

/** A 3×3 test matrix with values 1..9*channels, in OpenCV's interleaved layout. */
function makeMat(cv, depth, channels) {
  const typeName = `CV_${depth}C${channels}`;
  const type = cv[typeName];
  if (type === undefined) {
    throw new Error(`unknown cv type: ${typeName}`);
  }
  const data = [];
  for (let i = 1; i <= 9 * channels; i += 1) {
    data.push(i);
  }
  return { mat: cv.matFromArray(3, 3, type, data), data, typeName };
}

/**
 * Computes the expected values independently — without calling any code under test,
 * or the test would be wrong along with the implementation. data is a 3×3×C
 * interleaved array; px(r, c) returns the C channel values of that pixel.
 */
function expectedRegion(api, data, channels) {
  const px = (r, c) =>
    data.slice((r * 3 + c) * channels, (r * 3 + c + 1) * channels);
  if (api === "roi") {
    // Rect(x=1, y=1, w=2, h=2) → rows 1..2 × columns 1..2
    return [...px(1, 1), ...px(1, 2), ...px(2, 1), ...px(2, 2)];
  }
  if (api === "col") {
    return [...px(0, 2), ...px(1, 2), ...px(2, 2)];
  }
  if (api === "diag") {
    return [...px(0, 0), ...px(1, 1), ...px(2, 2)];
  }
  throw new Error(`unknown api: ${api}`);
}

/** Calls the region operation under test (roiClone / colClone / diagClone). */
function callRegion(cv, mat, api) {
  if (api === "roi") return mat.roiClone(new cv.Rect(1, 1, 2, 2));
  if (api === "col") return mat.colClone(2);
  if (api === "diag") return mat.diagClone();
  throw new Error(`unknown api: ${api}`);
}

module.exports = {
  DIST,
  getCv,
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
};
