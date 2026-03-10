const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "apps/hub/static/ui/ai-admin.html"), "utf8");

  assert(html.includes('data-layout="admin"'), "ai-admin should use admin layout");
  assert(html.includes("/admin/ai-overview"), "ai-admin should load admin ai overview api");
  assert(html.includes("AI Usage / Language / FAQ / Audit"), "ai-admin should expose admin ai heading");
  assert(html.includes("AI Usage Metrics"), "ai-admin should render AI usage metrics section");
  assert(html.includes("主要 AI 監査イベント"), "ai-admin should render ai audit section");
  assert(html.includes("FAQ 利用状況"), "ai-admin should render faq usage section");
  assert(html.includes("AI表示言語の運用状態"), "ai-admin should render language operations section");
  assert(!html.includes("Policy Matrix"), "ai-admin should no longer be skeleton-only");
}

module.exports = { run };
