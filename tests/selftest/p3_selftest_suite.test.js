"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const selftestScript = fs.readFileSync(path.join(process.cwd(), "scripts/selftest.js"), "utf8");
  const phase3Runner = fs.readFileSync(path.join(process.cwd(), "scripts/selftest-phase3.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

  const expected = [
    "p3_phase_boundary_sot.test.js",
    "p3_search_model.test.js",
    "p3_workspace_search_api.test.js",
    "p3_workspace_search_audit.test.js",
    "p3_workspace_search_indexing.test.js",
    "p3_history_api.test.js",
    "p3_workspace_metrics_api.test.js",
    "p3_run_retry_api.test.js",
    "p3_workspace_export_api.test.js",
    "p3_secret_masking.test.js",
    "p3_workspace_search_ui.test.js",
  ];

  expected.forEach((name) => {
    const filePath = path.join(process.cwd(), "tests", "selftest", name);
    assert(fs.existsSync(filePath), `${name} should exist`);
    assert(selftestScript.includes(`'${name}'`), `${name} should be registered in scripts/selftest.js`);
    assert(
      phase3Runner.includes(`'${name}'`) || phase3Runner.includes(`"${name}"`),
      `${name} should be registered in scripts/selftest-phase3.js`
    );
  });

  assert(packageJson.scripts && packageJson.scripts["test:p3"], "package.json should include test:p3");
  assert(
    String(packageJson.scripts["test:p3"]).includes("scripts/selftest-phase3.js"),
    "test:p3 should execute scripts/selftest-phase3.js"
  );
}

module.exports = { run };
