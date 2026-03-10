const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const helpHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help.html"), "utf8");
  const dashboardHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/dashboard.html"), "utf8");
  const sidebarHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/partials/sidebar.html"), "utf8");
  const sidebarJs = fs.readFileSync(path.join(root, "apps/hub/static/ui/sidebar.js"), "utf8");
  const ja = fs.readFileSync(path.join(root, "apps/hub/static/ui/i18n/ja.json"), "utf8");
  const en = fs.readFileSync(path.join(root, "apps/hub/static/ui/i18n/en.json"), "utf8");

  assert(helpHtml.includes('data-page="help"'), "help UI should register help page key");
  assert(helpHtml.includes('audience: "general"'), "help UI should lock FAQ audience to general");
  assert(helpHtml.includes('/faq/query'), "help UI should call faq query api");
  assert(helpHtml.includes('help-ai-display-language'), "help UI should include AI display language selector");
  assert(helpHtml.includes('運用者向けの Workspace / runbook 操作導線とは分離'), "help UI should separate from operator flows");
  assert(helpHtml.includes('/ui/project-workspace.html'), "help UI may link to workspace only as escalation path");

  assert(dashboardHtml.includes('/ui/help.html'), "dashboard should include help faq entry");
  assert(sidebarHtml.includes('href="/ui/help.html"'), "sidebar should include help faq nav link");
  assert(sidebarJs.includes('file === "help.html"'), "sidebar should activate help page");

  assert(ja.includes('"nav.help": "ヘルプ / FAQ"'), "ja i18n should include help nav label");
  assert(en.includes('"nav.help": "Help / FAQ"'), "en i18n should include help nav label");
}

module.exports = { run };
