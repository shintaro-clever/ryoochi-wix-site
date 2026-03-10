const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");

  assert(workspaceHtml.includes("AI Usage Metrics"), "workspace should include AI usage metrics section");
  assert(workspaceHtml.includes("workspace-metrics-ai-usage"), "workspace should include AI usage metrics container");
  assert(workspaceHtml.includes("renderAiUsageMetrics(payload"), "workspace should render AI usage metrics");
  assert(workspaceHtml.includes("faq_resolution_rate"), "workspace AI usage metrics should render FAQ resolution rate");
  assert(workspaceHtml.includes("translation_requests"), "workspace AI usage metrics should render translation requests");
}

module.exports = { run };
