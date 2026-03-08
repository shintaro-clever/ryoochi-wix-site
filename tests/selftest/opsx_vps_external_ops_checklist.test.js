const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const agentsPath = path.join(process.cwd(), "AGENTS.md");
  const networkRulePath = path.join(process.cwd(), "agents", "rules", "10-network.md");
  const runbookPath = path.join(process.cwd(), "docs", "runbooks", "vps-external-operations-checklist.md");
  const readmePath = path.join(process.cwd(), "README.md");

  assert(fs.existsSync(agentsPath), "AGENTS.md should exist");
  assert(fs.existsSync(networkRulePath), "10-network rule should exist");
  assert(fs.existsSync(runbookPath), "vps external operations runbook should exist");
  assert(fs.existsSync(readmePath), "README should exist");

  const agents = fs.readFileSync(agentsPath, "utf8");
  const rule = fs.readFileSync(networkRulePath, "utf8");
  const runbook = fs.readFileSync(runbookPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(agents.includes("vps-external-operations-checklist.md"), "AGENTS should link external ops checklist");
  assert(rule.includes("vps-external-operations-checklist.md"), "network rule should reference runbook");
  assert(rule.includes("read-only"), "network rule should include read-only verification");
  assert(rule.includes("dry-run"), "network rule should include dry-run verification");
  assert(rule.includes("confirm"), "network rule should include confirm verification");
  assert(rule.includes("Figma 再現度評価"), "network rule should include figma fidelity verification");

  assert(runbook.includes("Read-only verification"), "runbook should define read-only verification");
  assert(runbook.includes("Dry-run / plan verification"), "runbook should define dry-run verification");
  assert(runbook.includes("Confirm execution verification"), "runbook should define confirm verification");
  assert(runbook.includes("GitHub write verification"), "runbook should define github verification");
  assert(runbook.includes("Figma write verification"), "runbook should define figma verification");
  assert(runbook.includes("Figma fidelity verification"), "runbook should define figma fidelity verification");
  assert(runbook.includes("score_total >= 95"), "runbook should require figma score >= 95");
  assert(runbook.includes("rollback / retry"), "runbook should define rollback/retry policy");
  assert(runbook.includes("Secret Safety"), "runbook should include secret safety rule");

  assert(readme.includes("vps-external-operations-checklist.md"), "README should link OPSX-01 runbook");
}

module.exports = { run };
