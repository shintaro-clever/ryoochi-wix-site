const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "apps/hub/static/ui/knowledge-admin.html"), "utf8");

  assert(html.includes('data-layout="admin"'), "knowledge-admin should use admin layout");
  assert(html.includes("/admin/knowledge-sources"), "knowledge-admin should call admin knowledge source api");
  assert(html.includes("FAQ Knowledge Source Policy"), "knowledge-admin should expose knowledge source policy heading");
  assert(html.includes("enabled") && html.includes("priority") && html.includes("public_scope"), "knowledge-admin should render policy controls");
  assert(html.includes("FAQ model"), "knowledge-admin should keep faq model guide");
  assert(html.includes("Glossary"), "knowledge-admin should keep glossary guide");
}

module.exports = { run };
