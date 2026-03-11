"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const confirmHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/execution-plan-confirm.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");

  assert(confirmHtml.includes("変更対象"), "confirm screen should render target section");
  assert(confirmHtml.includes("影響範囲"), "confirm screen should render impact section");
  assert(confirmHtml.includes("rollback"), "confirm screen should render rollback section");
  assert(confirmHtml.includes("根拠"), "confirm screen should render evidence section");
  assert(confirmHtml.includes("承認者"), "confirm screen should render approver");
  assert(confirmHtml.includes("期限"), "confirm screen should render expiry");
  assert(workspaceHtml.includes("workspace-execution-confirm-link"), "workspace should link to execution confirm screen");
}

module.exports = { run };
