"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  DEPTHS,
  CHANNELS,
  describeError,
  makeMat,
  expectedRegion,
  callRegion,
} = require("../helpers");

const APIS = ["roi", "col", "diag"];

for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    for (const api of APIS) {
      const typeName = `CV_${depth}C${channels}`;

      test(`${api}() on ${typeName} 返回连续且正确的数据`, () => {
        const { mat, data } = makeMat(depth, channels);
        let out;
        try {
          out = callRegion(mat, api);
        } catch (e) {
          mat.delete();
          assert.fail(`${api}() on ${typeName} 崩溃: ${describeError(e)}`);
        }

        const want = expectedRegion(api, data, channels);
        const got = Array.from(out.DATA());

        assert.strictEqual(
          out.isContinuous(),
          true,
          `${api}() on ${typeName} 返回了非连续 Mat —— .data* 读取会得到错误数据`,
        );
        assert.deepStrictEqual(got, want, `${api}() on ${typeName} 数据错误`);

        mat.delete();
        out.delete();
      });
    }
  }
}
