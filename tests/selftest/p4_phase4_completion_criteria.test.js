const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const workflowPath = path.join(process.cwd(), "docs", "ai", "core", "workflow.md");
  const backlogPath = path.join(process.cwd(), "backlog", "phase4-fidelity-hardening.md");
  const readmePath = path.join(process.cwd(), "README.md");

  assert(fs.existsSync(workflowPath), "workflow should exist");
  assert(fs.existsSync(backlogPath), "phase4 backlog should exist");
  assert(fs.existsSync(readmePath), "README should exist");

  const workflow = fs.readFileSync(workflowPath, "utf8");
  const backlog = fs.readFileSync(backlogPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(workflow.includes("NEXT4-01 Phase4 Completion Criteria"), "workflow should define phase4 completion criteria");
  assert(workflow.includes("SoT 固定"), "workflow should require SoT");
  assert(workflow.includes("比較固定"), "workflow should require comparison");
  assert(workflow.includes("スコア固定"), "workflow should require score");
  assert(workflow.includes("理由分類固定"), "workflow should require reason taxonomy");
  assert(workflow.includes("Run 証跡固定"), "workflow should require run evidence");
  assert(workflow.includes("UI 固定"), "workflow should require UI");
  assert(workflow.includes("selftest 固定"), "workflow should require selftest");
  assert(workflow.includes("VPS / 本番確認固定"), "workflow should require VPS confirmation");
  assert(workflow.includes("final_score >= 95"), "workflow should define acceptance score");
  assert(workflow.includes("docs/runbooks/fidelity-hardening-operations.md"), "workflow should link fidelity runbook");

  assert(backlog.includes("NEXT4-01 Phase4 Completion Criteria"), "backlog should reference completion criteria");
  assert(backlog.includes("Exit Checklist"), "backlog should include exit checklist");
  assert(backlog.includes("scripts/selftest.js"), "backlog should mention selftest registration");
  assert(backlog.includes("vps-external-operations-checklist.md"), "backlog should mention VPS checklist");

  assert(readme.includes("Phase4 完了条件 SoT"), "README should link phase4 completion criteria");
}

module.exports = { run };
