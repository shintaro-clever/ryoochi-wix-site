"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");

  assert(html.includes("Execution Monitoring"), "ops console should include execution monitoring section");
  assert(html.includes("/admin/execution-overview"), "ops console should call execution overview api");
  assert(html.includes("execution plan / job の一覧、状態、失敗、confirm待ち"), "ops console should describe execution monitoring scope");
  assert(html.includes("ops-console-confirm-waiting"), "ops console should render confirm waiting container");
  assert(html.includes("ops-console-failed-jobs"), "ops console should render failed jobs container");
  assert(html.includes("ops-console-execution-plans"), "ops console should render execution plans list");
  assert(html.includes("ops-console-execution-jobs"), "ops console should render execution jobs list");
  assert(html.includes("confirmなし自動実行は扱わない"), "ops console should preserve phase boundary guardrail");
}

module.exports = { run };
