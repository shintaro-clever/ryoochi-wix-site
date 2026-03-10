"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = process.cwd();
  const selftestScript = fs.readFileSync(path.join(root, "scripts/selftest.js"), "utf8");
  const expected = [
    "p6_rbac_api.test.js",
    "p6_connection_lifecycle_api.test.js",
    "p6_admin_base_ui.test.js",
    "p6_members_invites_ui.test.js",
    "p6_connections_ui.test.js",
    "p6_ai_admin_overview_api.test.js",
    "p6_ai_admin_ui.test.js",
    "p6_knowledge_sources_api.test.js",
    "p6_knowledge_admin_ui.test.js",
    "p6_i18n_admin_policy_api.test.js",
    "p6_i18n_admin_ui.test.js",
    "p6_admin_audit_overview_api.test.js",
    "p6_ops_console_ui.test.js",
    "p6_b_inventory_residual_ui.test.js",
  ];

  expected.forEach((name) => {
    const filePath = path.join(root, "tests", "selftest", name);
    assert(fs.existsSync(filePath), `${name} should exist`);
    assert(selftestScript.includes(`'${name}'`), `${name} should be registered in scripts/selftest.js`);
  });

  const adminConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/admin-console.html"), "utf8");
  const opsConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");
  const aiAdmin = fs.readFileSync(path.join(root, "apps/hub/static/ui/ai-admin.html"), "utf8");
  const knowledgeAdmin = fs.readFileSync(path.join(root, "apps/hub/static/ui/knowledge-admin.html"), "utf8");
  const members = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-members.html"), "utf8");
  const invites = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-invites.html"), "utf8");
  const settingsConnections = fs.readFileSync(path.join(root, "apps/hub/static/ui/settings-connections.html"), "utf8");
  const projectConnections = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-connections.html"), "utf8");
  const projectAudit = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-audit.html"), "utf8");

  [
    adminConsole,
    opsConsole,
    aiAdmin,
    knowledgeAdmin,
    members,
    invites,
  ].forEach((html, index) => {
    assert(html.includes('data-layout="admin"'), `admin layout page #${index + 1} should keep data-layout=admin`);
  });

  assert(adminConsole.includes("/ui/"), "admin console should keep /ui/ canonical links");
  assert(opsConsole.includes("/ui/"), "ops console should keep /ui/ canonical links");
  assert(aiAdmin.includes("/ui/knowledge-admin.html"), "ai admin should keep /ui/ admin links");
  assert(knowledgeAdmin.includes("/ui/ai-admin.html"), "knowledge admin should keep /ui/ admin links");
  assert(members.includes("/api/admin/organizations"), "members ui should remain on admin api");
  assert(invites.includes("/api/admin/organizations"), "invites ui should remain on admin api");
  assert(settingsConnections.includes('scope_type=account') || settingsConnections.includes('scope_type: "account"'), "account connections ui should keep account scope");
  assert(projectConnections.includes('scope_type=project') || projectConnections.includes('scope_type: "project"'), "project connections ui should keep project scope");
  assert(projectAudit.includes("/admin/audit-overview"), "project audit should keep admin audit overview bridge");
}

module.exports = { run };
