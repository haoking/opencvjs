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

// 2.0 起被测的是 roiClone / colClone / diagClone（见 helpers.callRegion）；
// 这里的 api 名只是用例标识与期望值分支的键，故保持 roi/col/diag 不变。
const APIS = ["roi", "col", "diag"];

for (const depth of DEPTHS) {
  for (const channels of CHANNELS) {
    for (const api of APIS) {
      const typeName = `CV_${depth}C${channels}`;

      test(`${api}Clone() on ${typeName} 返回连续且正确的数据`, async () => {
        const cv = await getCv();
        const { mat, data } = makeMat(cv, depth, channels);
        let out;
        try {
          try {
            out = callRegion(cv, mat, api);
          } catch (e) {
            assert.fail(
              `${api}Clone() on ${typeName} 崩溃: ${describeError(e)}`,
            );
          }

          const want = expectedRegion(api, data, channels);
          const got = Array.from(out.DATA());

          assert.strictEqual(
            out.isContinuous(),
            true,
            `${api}Clone() on ${typeName} 返回了非连续 Mat —— .data* 读取会得到错误数据`,
          );
          assert.deepStrictEqual(
            got,
            want,
            `${api}Clone() on ${typeName} 数据错误`,
          );
        } finally {
          mat.delete();
          if (out) out.delete();
        }
      });
    }
  }
}
