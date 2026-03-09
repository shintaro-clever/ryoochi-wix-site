const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const selftestScript = fs.readFileSync(path.join(process.cwd(), "scripts/selftest.js"), "utf8");
  const expected = [
    "p4_structure_diff_enhanced.test.js",
    "p4_visual_diff_enhanced.test.js",
    "p4_behavior_diff_api.test.js",
    "p4_execution_diff_api.test.js",
    "p4_reason_taxonomy.test.js",
    "p4_run_fidelity_evidence.test.js",
    "p4_ui_fidelity_dashboard.test.js",
    "p4_ui_before_after_compare.test.js",
  ];

  expected.forEach((name) => {
    const filePath = path.join(process.cwd(), "tests", "selftest", name);
    assert(fs.existsSync(filePath), `${name} should exist`);
    assert(selftestScript.includes(`'${name}'`), `${name} should be registered in scripts/selftest.js`);
  });
}

module.exports = { run };
