const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("OBS no muestra la atribucion que corresponde al dashboard", () => {
  const html = fs.readFileSync(path.join(__dirname, "../obs.html"), "utf8");
  assert.doesNotMatch(html, /id=["']atribucion["']/i);
  assert.doesNotMatch(html, /elAtribucion/);
});
