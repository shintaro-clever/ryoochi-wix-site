const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/phase6-admin-ops.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const adminConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/admin-console.html"), "utf8");
  const opsConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");

  assert(runbook.includes("権限事故対応"), "phase6 runbook should include permission incident response");
  assert(runbook.includes("誤招待対応"), "phase6 runbook should include invite incident response");
  assert(runbook.includes("接続停止 / 接続異常対応"), "phase6 runbook should include connection outage response");
  assert(runbook.includes("AI設定確認"), "phase6 runbook should include ai admin operation");
  assert(runbook.includes("監査確認"), "phase6 runbook should include audit checks");
  assert(runbook.includes("FAQ知識源管理"), "phase6 runbook should include knowledge source management");
  assert(runbook.includes("多言語設定管理"), "phase6 runbook should include i18n policy management");
  assert(runbook.includes("Connections Registry"), "phase6 runbook should include connections registry usage");
  assert(runbook.includes("Project Audit Bridge"), "phase6 runbook should include project audit bridge usage");

  assert(readme.includes("docs/runbooks/phase6-admin-ops.md"), "README should reference phase6 runbook");
  assert(adminConsole.includes("docs/runbooks/phase6-admin-ops.md"), "admin console should link phase6 runbook");
  assert(opsConsole.includes("docs/runbooks/phase6-admin-ops.md"), "ops console should link phase6 runbook");
}

module.exports = { run };
