"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = process.cwd();
  const workflow = fs.readFileSync(path.join(root, "docs/ai/core/workflow.md"), "utf8");
  const backlog = fs.readFileSync(path.join(root, "backlog/phase7-execution-layer.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert(workflow.includes("NEXT7-01 Phase7 Completion Criteria (SoT)"), "workflow should define Phase7 completion criteria");
  assert(workflow.includes("execution plan"), "workflow should include execution plan in Phase7 completion criteria");
  assert(workflow.includes("confirm flow"), "workflow should include confirm flow in Phase7 completion criteria");
  assert(workflow.includes("execution job"), "workflow should include execution job in Phase7 completion criteria");
  assert(workflow.includes("Run Integration 固定"), "workflow should include run integration in Phase7 completion criteria");
  assert(workflow.includes("Audit 固定"), "workflow should include audit in Phase7 completion criteria");
  assert(workflow.includes("selftest 固定"), "workflow should include selftest in Phase7 completion criteria");
  assert(workflow.includes("Runbook 固定"), "workflow should include runbook in Phase7 completion criteria");
  assert(workflow.includes("Ops Console 固定"), "workflow should include ops console in Phase7 completion criteria");

  assert(backlog.includes("execution plan"), "backlog should include execution plan in completion criteria");
  assert(backlog.includes("confirm flow"), "backlog should include confirm flow in completion criteria");
  assert(backlog.includes("execution job"), "backlog should include execution job in completion criteria");
  assert(backlog.includes("Run integration"), "backlog should include run integration in completion criteria");
  assert(backlog.includes("audit"), "backlog should include audit in completion criteria");
  assert(backlog.includes("selftest"), "backlog should include selftest in completion criteria");
  assert(backlog.includes("runbook"), "backlog should include runbook in completion criteria");
  assert(backlog.includes("ops console"), "backlog should include ops console in completion criteria");

  assert(readme.includes("NEXT7-01"), "README should reference Phase7 completion criteria");
  assert(readme.includes("Run integration"), "README should include run integration in Phase7 completion summary");
  assert(readme.includes("execution plan"), "README should include execution plan in Phase7 completion summary");
  assert(readme.includes("confirm flow"), "README should include confirm flow in Phase7 completion summary");
  assert(readme.includes("execution job"), "README should include execution job in Phase7 completion summary");
  assert(readme.includes("audit"), "README should include audit in Phase7 completion summary");
  assert(readme.includes("selftest"), "README should include selftest in Phase7 completion summary");
  assert(readme.includes("runbook"), "README should include runbook in Phase7 completion summary");
}

module.exports = { run };
