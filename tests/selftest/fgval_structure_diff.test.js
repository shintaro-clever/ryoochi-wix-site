const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");
const { compareFigmaStructure } = require("../../src/integrations/figma/structureDiff");

function readFixture(name) {
  const fixturePath = path.join(process.cwd(), "tests", "selftest", "fixtures", name);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

async function run() {
  const baseline = readFixture("figma_structure_baseline.json");
  const candidateGood = readFixture("figma_structure_candidate_good.json");
  const candidateBad = readFixture("figma_structure_candidate_bad.json");

  const goodResult = compareFigmaStructure(baseline, candidateGood, { threshold: 0.9 });
  assert(goodResult.major_diff_detected === false, "good candidate should not detect major diff");
  assert(goodResult.structural_reproduction.pass === true, "good candidate should pass structural reproduction");
  assert(goodResult.diffs.target_mismatches.length === 0, "good candidate should keep target matched");
  assert(goodResult.diffs.parent_mismatches.length === 0, "good candidate should keep parent relation matched");

  const badResult = compareFigmaStructure(baseline, candidateBad, { threshold: 0.9 });
  assert(badResult.major_diff_detected === true, "bad candidate should detect major diff");
  assert(badResult.structural_reproduction.pass === false, "bad candidate should fail structural reproduction");
  assert(badResult.diffs.target_mismatches.length >= 1, "bad candidate should detect target mismatch");
  assert(badResult.diffs.parent_mismatches.length >= 1, "bad candidate should detect parent mismatch");
  assert(badResult.diffs.auto_layout_mismatches.length >= 1, "bad candidate should detect auto layout mismatch");
  assert(badResult.diffs.text_mismatches.length >= 1, "bad candidate should detect text mismatch");
  assert(badResult.diffs.component_mismatches.length >= 1, "bad candidate should detect component mismatch");
}

module.exports = { run };
