const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const workflow = fs.readFileSync(path.join(process.cwd(), "docs/ai/core/workflow.md"), "utf8");
  const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
  const backlog = fs.readFileSync(path.join(process.cwd(), "backlog/next3-workspace-operations-hardening.md"), "utf8");
  const agents = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf8");

  assert(workflow.includes("検索 / 履歴 / 可観測性 / 運用性改善"), "workflow should define phase3 scope");
  assert(workflow.includes("`search`（Run / external operations / audit を横断検索できる最小要件）"), "workflow should define search first");
  assert(workflow.includes("時系列の追跡と差分参照を安定化"), "workflow should define history second");
  assert(workflow.includes("`observability`（失敗分類・遅延・再試行判断に必要な可視化）"), "workflow should define observability third");
  assert(workflow.includes("`operability`（運用導線・手順・権限境界の改善）"), "workflow should define operability fourth");
  assert(workflow.includes("複数AI接続・役割設定"), "workflow should exclude multi-ai expansion");
  assert(workflow.includes("Figma / GitHub 高度操作の新規拡張"), "workflow should exclude advanced figma/github expansion");
  assert(workflow.includes("完全自動同期"), "workflow should exclude full auto sync");

  assert(readme.includes("`search` → `history` → `observability` → `operability`"), "README should keep fixed phase3 order");
  assert(readme.includes("複数AI接続・役割設定"), "README should exclude multi-ai expansion");
  assert(readme.includes("Figma / GitHub 高度操作の追加拡張"), "README should exclude advanced figma/github expansion");
  assert(readme.includes("完全自動同期"), "README should exclude full auto sync");

  assert(backlog.includes("## Scope (Phase3 Entry)"), "backlog should define phase3 scope");
  assert(backlog.includes("## Start Order (Fixed)"), "backlog should define fixed order");
  assert(backlog.includes("Multi-AI connections or role/profile/persona routing expansion."), "backlog should exclude multi-ai expansion");
  assert(backlog.includes("New advanced Figma/GitHub operation expansion"), "backlog should exclude advanced figma/github expansion");
  assert(backlog.includes("Fully automated sync without human approval."), "backlog should exclude full auto sync");

  assert(agents.includes("search -> history -> observability -> operability"), "AGENTS should keep phase3 order");
  assert(agents.includes("複数AI接続・役割設定"), "AGENTS should exclude multi-ai expansion");
  assert(agents.includes("Figma/GitHub 高度操作の追加拡張"), "AGENTS should exclude advanced figma/github expansion");
  assert(agents.includes("完全自動同期"), "AGENTS should exclude full auto sync");
}

module.exports = { run };
