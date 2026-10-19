"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  getCv,
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
} = require("../helpers");

// The methods under test are roiClone / colClone / diagClone (see helpers.callRegion);
// the api names here only label the cases and select the expected values.
const APIS = ["roi", "col", "diag"];

for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    for (const api of APIS) {
      const typeName = `CV_${depth}C${channels}`;

      test(`${api}Clone() on ${typeName} returns continuous, correct data`, async () => {
        const cv = await getCv();
        const { mat, data } = makeMat(cv, depth, channels);
        let out;
        try {
          try {
            out = callRegion(cv, mat, api);
          } catch (e) {
            assert.fail(
              `${api}Clone() on ${typeName} crashed: ${describeError(e)}`,
            );
          }

          const want = expectedRegion(api, data, channels);
          const got = Array.from(out.DATA());

          assert.strictEqual(
            out.isContinuous(),
            true,
            `${api}Clone() on ${typeName} returned a non-continuous Mat; reading .data* would give wrong data`,
          );
          assert.deepStrictEqual(
            got,
            want,
            `${api}Clone() on ${typeName} returned wrong data`,
          );
        } finally {
          mat.delete();
          if (out) out.delete();
        }
      });
    }
  }
}
