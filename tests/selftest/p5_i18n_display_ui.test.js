const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const runHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/run.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");
  const languageHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/settings-language.html"), "utf8");

  assert(runHtml.includes("run-ai-display-language"), "run UI should include AI display language selector");
  assert(runHtml.includes("translateAiPayload(\"run_summary\""), "run UI should translate run summaries via ai/translate");
  assert(runHtml.includes("外観設定保存UIとは分離"), "run UI should separate AI display language from appearance settings");

  assert(workspaceHtml.includes("workspace-ai-display-language"), "workspace UI should include AI display language selector");
  assert(workspaceHtml.includes("data-alert-analysis-button"), "workspace observability alerts should include analysis buttons");
  assert(workspaceHtml.includes("workspace-metrics-analysis-list"), "workspace should include observability analysis panel");
  assert(workspaceHtml.includes("workspace-faq-render"), "workspace should include FAQ answer viewer");
  assert(workspaceHtml.includes("translateAiPayload(\"faq\""), "workspace should translate FAQ answers via ai/translate");

  assert(languageHtml.includes("Run要約 / History要約 / Observability要約 / 異常分析 / FAQ回答"), "language settings should mention AI display scope");
  assert(languageHtml.includes("AI表示言語は外観設定保存UIとは分離"), "language settings should clarify separation from appearance settings");
}

module.exports = { run };
