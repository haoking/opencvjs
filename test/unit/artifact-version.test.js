"use strict";

// The artifact's OpenCV version must match build/opencv-version.txt.
//
// ci.yml does not build the wasm itself; it downloads what build-wasm.yml built, selected
// by the fingerprint of the build inputs (build/fingerprint.sh). This compares the version
// number as an independent check. The only version check before it was "CascadeClassifier
// is absent", which tells 4.x from 5.x and nothing more: another 5.x minor release, or a
// build from another branch with a changed whitelist, stayed green.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { getCv } = require("../helpers");

const VERSION_FILE = path.join(
  __dirname,
  "..",
  "..",
  "build",
  "opencv-version.txt",
);

test("the artifact's OpenCV version matches build/opencv-version.txt", async () => {
  const cv = await getCv();
  const want = fs.readFileSync(VERSION_FILE, "utf8").trim();
  const m = /General configuration for OpenCV (\S+)/.exec(
    cv.getBuildInformation(),
  );
  assert.ok(
    m,
    "no version line in getBuildInformation(); did the output format change?",
  );
  assert.strictEqual(
    m[1],
    want,
    `the artifact is OpenCV ${m[1]}, but build/opencv-version.txt pins ${want}; ` +
      `the artifacts may come from another branch or another version`,
  );
});
