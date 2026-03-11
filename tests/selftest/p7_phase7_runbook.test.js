"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = process.cwd();
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/phase7-execution-ops.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert(runbook.includes("Phase7 Execution Ops Runbook"), "phase7 runbook should exist");
  assert(runbook.includes("confirm待ち対応"), "phase7 runbook should include confirm pending operation");
  assert(runbook.includes("承認"), "phase7 runbook should include approval operation");
  assert(runbook.includes("却下"), "phase7 runbook should include rejection operation");
  assert(runbook.includes("失敗 job 対応"), "phase7 runbook should include failed job operation");
  assert(runbook.includes("rollback"), "phase7 runbook should include rollback operation");
  assert(runbook.includes("/ui/write-plans.html"), "phase7 runbook should include write-plan UI");
  assert(runbook.includes("/ui/execution-plan-confirm.html"), "phase7 runbook should include execution confirm UI");
  assert(runbook.includes("/ui/ops-console.html"), "phase7 runbook should include ops console UI");
  assert(runbook.includes("/ui/run.html"), "phase7 runbook should include run detail UI");
  assert(runbook.includes("plan.created"), "phase7 runbook should include plan audit actions");
  assert(runbook.includes("job.finished"), "phase7 runbook should include job audit actions");
  assert(runbook.includes("confirmなし自動実行"), "phase7 runbook should restate phase boundary exclusions");

  assert(readme.includes("docs/runbooks/phase7-execution-ops.md"), "README should reference phase7 runbook");
}

module.exports = { run };
