const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const adminConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/admin-console.html"), "utf8");
  const projectAudit = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-audit.html"), "utf8");
  const connections = fs.readFileSync(path.join(root, "apps/hub/static/ui/connections.html"), "utf8");

  assert(adminConsole.includes('/admin/organizations'), "admin-console should load organizations");
  assert(adminConsole.includes('/admin/organizations/${organizationId}/roles'), "admin-console should load roles");
  assert(!adminConsole.includes("detail skeleton"), "admin-console should no longer expose skeleton copy");

  assert(projectAudit.includes('/admin/audit-overview?${params.toString()}'), "project-audit should load admin audit overview");
  assert(projectAudit.includes('/projects'), "project-audit should load project list");
  assert(!projectAudit.includes("未実装（次フェーズで対応）"), "project-audit should not keep not-implemented copy");

  assert(connections.includes('/admin/connections'), "connections registry should load admin connections");
  assert(connections.includes('/ui/settings-connections.html'), "connections registry should link to account management");
  assert(!connections.includes("未実装（次フェーズで対応）"), "connections registry should not keep not-implemented copy");
}

module.exports = { run };
