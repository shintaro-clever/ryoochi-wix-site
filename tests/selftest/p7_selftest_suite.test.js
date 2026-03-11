"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = process.cwd();
  const selftestScript = fs.readFileSync(path.join(root, "scripts/selftest.js"), "utf8");
  const expected = [
    "p7_write_plan_model.test.js",
    "p7_write_plan_ui.test.js",
    "p7_execution_plan_model.test.js",
    "p7_execution_job_model.test.js",
    "p7_execution_audit.test.js",
    "p7_confirm_flow_api.test.js",
    "p7_confirm_flow_ui.test.js",
    "p7_run_execution_trace.test.js",
    "p7_run_execution_trace_ui.test.js",
    "p7_figma_execution_plan_job.test.js",
    "p7_github_execution_plan_job.test.js",
    "p7_ops_console_execution_api.test.js",
    "p7_ops_console_execution_ui.test.js",
  ];

  expected.forEach((name) => {
    const filePath = path.join(root, "tests", "selftest", name);
    assert(fs.existsSync(filePath), `${name} should exist`);
    assert(selftestScript.includes(`'${name}'`), `${name} should be registered in scripts/selftest.js`);
  });

  const runHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/run.html"), "utf8");
  const confirmHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/execution-plan-confirm.html"), "utf8");
  const writePlansHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/write-plans.html"), "utf8");
  const opsConsoleHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");

  assert(runHtml.includes("run-related-execution-plans"), "run UI should keep execution plan trace");
  assert(runHtml.includes("run-related-execution-jobs"), "run UI should keep execution job trace");
  assert(confirmHtml.includes("rollback_plan"), "confirm UI should keep rollback display");
  assert(confirmHtml.includes("evidence_refs"), "confirm UI should keep evidence display");
  assert(writePlansHtml.includes("Write Plan Console"), "write-plan UI should keep management console");
  assert(writePlansHtml.includes("承認待ち"), "write-plan UI should keep approval pending view");
  assert(opsConsoleHtml.includes("Execution Monitoring"), "ops console should keep execution monitoring");
  assert(opsConsoleHtml.includes("/admin/execution-overview"), "ops console should keep execution overview API integration");
}

module.exports = { run };
