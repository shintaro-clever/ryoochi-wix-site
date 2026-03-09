const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const runbookPath = path.join(process.cwd(), "docs", "runbooks", "fidelity-hardening-operations.md");
  const envPath = path.join(process.cwd(), "docs", "operations", "fidelity-environments.md");
  const checklistPath = path.join(process.cwd(), "docs", "runbooks", "vps-external-operations-checklist.md");
  const readmePath = path.join(process.cwd(), "README.md");

  assert(fs.existsSync(runbookPath), "fidelity hardening runbook should exist");
  assert(fs.existsSync(envPath), "fidelity environments doc should exist");
  assert(fs.existsSync(checklistPath), "vps checklist should exist");
  assert(fs.existsSync(readmePath), "README should exist");

  const runbook = fs.readFileSync(runbookPath, "utf8");
  const envDoc = fs.readFileSync(envPath, "utf8");
  const checklist = fs.readFileSync(checklistPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(runbook.includes("localhost baseline check"), "runbook should include localhost check");
  assert(runbook.includes("staging comparison"), "runbook should include staging comparison");
  assert(runbook.includes("production comparison"), "runbook should include production comparison");
  assert(runbook.includes("Expected Outputs"), "runbook should include expected outputs");
  assert(runbook.includes("Failure Triage"), "runbook should include failure triage");
  assert(runbook.includes("Rollback Viewpoints"), "runbook should include rollback viewpoints");
  assert(runbook.includes("environment_only_mismatch"), "runbook should mention environment_only_mismatch");
  assert(runbook.includes("component failure rate"), "runbook should mention component failure rate");

  assert(envDoc.includes("fidelity-hardening-operations.md"), "environment doc should reference fidelity runbook");
  assert(envDoc.includes("localhost -> staging -> production"), "environment doc should define fixed order");

  assert(checklist.includes("fidelity-hardening-operations.md"), "vps checklist should reference fidelity runbook");
  assert(readme.includes("fidelity-hardening-operations.md"), "README should link fidelity runbook");
}

module.exports = { run };
