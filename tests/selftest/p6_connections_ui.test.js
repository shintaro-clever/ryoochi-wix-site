const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const settingsHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/settings-connections.html"), "utf8");
  const projectHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-connections.html"), "utf8");
  const detailHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/connection.html"), "utf8");
  const apiJs = fs.readFileSync(path.join(root, "apps/hub/static/ui/api.js"), "utf8");

  assert(apiJs.includes("export async function apiDelete"), "ui api should expose delete helper for lifecycle ui");

  assert(settingsHtml.includes('data-layout="admin"'), "settings-connections should use admin layout");
  assert(settingsHtml.includes('scope_type: "account"'), "settings-connections should create account scope connection");
  assert(settingsHtml.includes('/admin/connections?scope_type=account'), "settings-connections should list account scope connections");
  assert(settingsHtml.includes("Personal / Account Connections"), "settings-connections should describe account responsibility");

  assert(projectHtml.includes('data-layout="admin"'), "project-connections should use admin layout");
  assert(projectHtml.includes('scope_type: "project"'), "project-connections should create project scope connection");
  assert(projectHtml.includes('/admin/connections?scope_type=project'), "project-connections should list project scope connections");
  assert(projectHtml.includes("/projects"), "project-connections should load project list");

  assert(detailHtml.includes('data-layout="admin"'), "connection detail should use admin layout");
  assert(detailHtml.includes('/admin/connections/${selectedConnectionId}/reauth'), "connection detail should support reauth");
  assert(detailHtml.includes('/admin/connections/${selectedConnectionId}/disable'), "connection detail should support disable");
  assert(detailHtml.includes('/admin/connections/${selectedConnectionId}/policy'), "connection detail should support policy update");
  assert(detailHtml.includes('/admin/connections/${selectedConnectionId}'), "connection detail should support delete/detail");
  assert(detailHtml.includes('scope_type=organization'), "connection detail should center organization scope selection");
}

module.exports = { run };
