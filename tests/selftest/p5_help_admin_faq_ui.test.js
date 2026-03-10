const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const adminHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help-admin.html"), "utf8");
  const helpHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");

  assert(adminHtml.includes('audience: "operator"'), "help-admin UI should lock FAQ audience to operator");
  assert(adminHtml.includes('data-runbook-path="docs/runbooks/vps-workspace-phase3-checklist.md"'), "help-admin should include phase3 runbook nav");
  assert(adminHtml.includes('data-runbook-path="docs/runbooks/fidelity-hardening-operations.md"'), "help-admin should include phase4 runbook nav");
  assert(adminHtml.includes('data-runbook-path="docs/runbooks/phase5-openai-assist-operations.md"'), "help-admin should include phase5 runbook nav");
  assert(adminHtml.includes('data-runbook-jump'), "help-admin should render runbook jump buttons from faq evidence");
  assert(adminHtml.includes('/faq/query'), "help-admin should call faq query api");

  assert(helpHtml.includes('/ui/help-admin.html'), "general help should link to operator faq/runbook nav");
  assert(workspaceHtml.includes('/ui/help-admin.html'), "workspace faq viewer should link to operator faq/runbook nav");
}

module.exports = { run };
