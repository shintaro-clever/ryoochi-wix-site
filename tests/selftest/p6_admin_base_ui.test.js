const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const adminSidebar = fs.readFileSync(path.join(root, "apps/hub/static/ui/partials/admin-sidebar.html"), "utf8");
  const sidebarJs = fs.readFileSync(path.join(root, "apps/hub/static/ui/sidebar.js"), "utf8");
  const adminConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/admin-console.html"), "utf8");
  const opsConsole = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");
  const aiAdmin = fs.readFileSync(path.join(root, "apps/hub/static/ui/ai-admin.html"), "utf8");
  const knowledgeAdmin = fs.readFileSync(path.join(root, "apps/hub/static/ui/knowledge-admin.html"), "utf8");
  const pagesMd = fs.readFileSync(path.join(root, "docs/ui/pages.md"), "utf8");

  assert(adminSidebar.includes("/ui/admin-console.html"), "admin sidebar should link to admin console");
  assert(adminSidebar.includes("/ui/ops-console.html"), "admin sidebar should link to ops console");
  assert(adminSidebar.includes("/ui/ai-admin.html"), "admin sidebar should link to ai admin");
  assert(adminSidebar.includes("/ui/knowledge-admin.html"), "admin sidebar should link to knowledge admin");
  assert(adminSidebar.includes("Workspace"), "admin sidebar should keep explicit return path to workspace");

  assert(sidebarJs.includes('data-layout') && sidebarJs.includes('/ui/partials/admin-sidebar.html'), "sidebar.js should mount admin sidebar for admin layout");
  assert(sidebarJs.includes('admin-console') && sidebarJs.includes('knowledge-admin'), "sidebar.js should infer admin nav keys");

  assert(adminConsole.includes('data-layout="admin"'), "admin console should use admin layout");
  assert(adminConsole.includes("Workspace UI とは別責務"), "admin console should distinguish from workspace");
  assert(adminConsole.includes("/admin/organizations"), "admin console should bind to admin organizations api");
  assert(adminConsole.includes("管理一覧"), "admin console should include list section");
  assert(adminConsole.includes("詳細パネル"), "admin console should include detail section");

  assert(opsConsole.includes("Organization Audit / Control Timeline"), "ops console should include audit heading");
  assert(opsConsole.includes("/admin/audit-overview"), "ops console should use audit overview api");

  assert(aiAdmin.includes("AI Usage / Language / FAQ / Audit"), "ai admin should include admin ai overview heading");
  assert(aiAdmin.includes("/admin/ai-overview"), "ai admin should use admin ai overview api");
  assert(aiAdmin.includes("/admin/i18n-policy"), "ai admin should include org language policy api");
  assert(knowledgeAdmin.includes("Knowledge Source Registry"), "knowledge admin should include source registry section");
  assert(knowledgeAdmin.includes("/admin/knowledge-sources"), "knowledge admin should use knowledge sources api");

  assert(pagesMd.includes("/ui/admin-console.html"), "pages SoT should include admin console");
  assert(pagesMd.includes("/ui/knowledge-admin.html"), "pages SoT should include knowledge admin");
}

module.exports = { run };
