"use strict";

/**
 * WebAssembly SIMD detection, and the rule that decides which variant to load.
 *
 * This module never touches the file system or loads wasm; it only answers two
 * questions: does this engine support SIMD, and which variant do the precedence rules
 * pick. index.js does the actual require and the fallback. Keeping the two apart lets
 * the tests cover detection without loading a 12 MB artifact.
 */

/**
 * The probe module, 31 bytes:
 *
 *   00 61 73 6d          magic "\0asm"
 *   01 00 00 00          version 1
 *   01 05                section 1 (Type), 5 bytes
 *     01                   1 type
 *     60 00 01 7b          func () -> (v128)      ← 0x7b is the v128 value type
 *   03 02                section 3 (Function), 2 bytes
 *     01 00                1 function, type index 0
 *   0a 0a                section 10 (Code), 10 bytes
 *     01                   1 body
 *     08                   8 bytes
 *     00                   0 local declarations
 *     41 00                i32.const 0
 *     fd 0f                i8x16.splat            ← 0xfd is the SIMD prefix
 *     fd 62                i8x16.popcnt
 *     0b                   end
 *
 * Three deliberate choices:
 *
 * 1. WebAssembly.validate() rather than compile()/instantiate(): it is synchronous, and
 *    loadOpenCV() must pick the variant before it requires anything.
 * 2. The result type is v128, so the module is only valid on an engine that knows SIMD
 *    types. test/unit/simd-detect.test.js shows the v128 byte is load-bearing (changing
 *    it to i32 makes validate() return false) and that the same module with scalar
 *    types validates — so a false can only come from missing SIMD support.
 * 3. It ends with i8x16.popcnt, an instruction added late in the SIMD proposal: engines
 *    that only implemented an early draft return false and get the baseline build, which
 *    is right because the SIMD build targets the final instruction set (the same reason
 *    wasm-feature-detect uses it).
 *
 * Not frozen: Object.freeze() throws on a non-empty TypedArray. Tests copy it with
 * .slice() before mutating.
 */
// prettier-ignore
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

/**
 * The probe without memoization; tests call it repeatedly, everything else goes through
 * detectSimd(). A missing WebAssembly global (possible in a bundled browser build) or any
 * exception counts as "no SIMD": a probe that throws would turn a case that can fall back
 * into a load failure.
 */
function probeSimd() {
  if (typeof WebAssembly === "undefined" || !WebAssembly.validate) {
    return false;
  }
  try {
    return WebAssembly.validate(SIMD_PROBE) === true;
  } catch {
    return false;
  }
}

let cachedProbe = null;

/** Memoized probe: an engine's capabilities do not change within a process. */
function detectSimd() {
  if (cachedProbe === null) {
    cachedProbe = probeSimd();
  }
  return cachedProbe;
}

/** For tests only: forget the memoized result. */
function resetSimdCache() {
  cachedProbe = null;
}

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

/**
 * Parses OPENCV_SIMD. An unrecognized value throws instead of being ignored: treating
 * OPENCV_SIMD=ture as "unset" would make the user believe SIMD was forced while the
 * probe decided.
 */
function parseEnvSimd(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  throw new TypeError(
    `Unrecognized OPENCV_SIMD value ${JSON.stringify(raw)}. ` +
      `Use ${[...TRUTHY].join("/")} to force SIMD or ${[...FALSY].join("/")} to force ` +
      `baseline; leave it unset to choose by runtime detection.`,
  );
}

/**
 * Decides which variant to load. Pure: it does not look at the file system.
 *
 * Precedence: options.simd  >  environment variable OPENCV_SIMD  >  runtime detection
 *
 * @param {{simd?: boolean}} [options]
 * @param {Record<string, string|undefined>} [env] defaults to process.env
 * @returns {{variant: "simd"|"baseline", source: "option"|"env"|"probe"}}
 *
 * `source` tells index.js whether it may fall back:
 *   - "option" / "env": the user named a variant. If it is missing, loading must throw;
 *     silently using the other one would turn "run the tests with OPENCV_SIMD=1" into a
 *     report about SIMD that actually measured baseline.
 *   - "probe": automatic. Falling back to baseline when the SIMD variant is missing is
 *     correct, because the baseline variant always ships.
 */
function resolveVariant(options, env) {
  const opts = options === undefined || options === null ? {} : options;
  if (typeof opts !== "object") {
    throw new TypeError(
      `loadOpenCV(options): options must be an object, got ${typeof opts}`,
    );
  }

  if (opts.simd !== undefined) {
    if (typeof opts.simd !== "boolean") {
      throw new TypeError(
        `loadOpenCV({ simd }): simd accepts only a boolean, got ${typeof opts.simd}`,
      );
    }
    return { variant: opts.simd ? "simd" : "baseline", source: "option" };
  }

  const environment =
    env || (typeof process !== "undefined" ? process.env : {}) || {};
  const fromEnv = parseEnvSimd(environment.OPENCV_SIMD);
  if (fromEnv !== undefined) {
    return { variant: fromEnv ? "simd" : "baseline", source: "env" };
  }

  return { variant: detectSimd() ? "simd" : "baseline", source: "probe" };
}

module.exports = {
  SIMD_PROBE,
  probeSimd,
  detectSimd,
  resetSimdCache,
  parseEnvSimd,
  resolveVariant,
};
