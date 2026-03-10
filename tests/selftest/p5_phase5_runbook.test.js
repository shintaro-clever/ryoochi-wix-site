const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/phase5-openai-assist-operations.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const adminHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help-admin.html"), "utf8");

  assert(runbook.includes("OpenAI 接続確認"), "phase5 runbook should include connection verification");
  assert(runbook.includes("レート制限時対応"), "phase5 runbook should include rate limit response");
  assert(runbook.includes("FAQ 誤回答時エスカレーション"), "phase5 runbook should include faq escalation");
  assert(runbook.includes("guardrail 発火時対応"), "phase5 runbook should include guardrail response");
  assert(runbook.includes("翻訳誤り修正"), "phase5 runbook should include translation correction");
  assert(runbook.includes("AI Usage Metrics"), "phase5 runbook should include metrics operation");
  assert(runbook.includes("Audit Check"), "phase5 runbook should include audit check");
  assert(runbook.includes("general FAQ から operator FAQ / runbook nav"), "phase5 runbook should include faq escalation route");

  assert(readme.includes("docs/runbooks/phase5-openai-assist-operations.md"), "README should reference phase5 runbook");
  assert(adminHtml.includes("docs/runbooks/phase5-openai-assist-operations.md"), "help-admin should link phase5 runbook");
}

module.exports = { run };
