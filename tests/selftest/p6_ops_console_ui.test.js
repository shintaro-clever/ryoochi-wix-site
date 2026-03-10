const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");

  assert(html.includes('data-layout="admin"'), "ops console should use admin layout");
  assert(html.includes("/admin/audit-overview"), "ops console should call admin audit overview api");
  assert(html.includes("Organization Audit / Control Timeline"), "ops console should present audit control heading");
  assert(html.includes("Cross-Domain Audit Filters"), "ops console should include audit filters");
  assert(html.includes("Audit Timeline"), "ops console should include timeline section");
  assert(html.includes("connection.lifecycle"), "ops console should reference connection lifecycle actions");
  assert(html.includes("faq.*"), "ops console should reference faq audit events");
  assert(html.includes("member / invite / role / connection / ai / faq"), "ops console should distinguish from workspace by audit scope");
}

module.exports = { run };
