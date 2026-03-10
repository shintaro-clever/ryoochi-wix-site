"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = process.cwd();
  const selftestScript = fs.readFileSync(path.join(root, "scripts/selftest.js"), "utf8");
  const expected = [
    "p5_openai_ai_verify.test.js",
    "p5_openai_client_wrapper.test.js",
    "p5_openai_data_boundary.test.js",
    "p5_ai_evidence_model.test.js",
    "p5_run_ai_summary.test.js",
    "p5_workspace_ai_summaries.test.js",
    "p5_observability_ai_analysis.test.js",
    "p5_ai_translate.test.js",
    "p5_faq_query_api.test.js",
    "p5_faq_guardrails.test.js",
    "p5_help_faq_ui.test.js",
    "p5_help_admin_faq_ui.test.js",
    "p5_i18n_display_ui.test.js",
    "p5_ai_usage_metrics.test.js",
    "p5_workspace_ai_metrics_ui.test.js",
  ];

  expected.forEach((name) => {
    const filePath = path.join(root, "tests", "selftest", name);
    assert(fs.existsSync(filePath), `${name} should exist`);
    assert(selftestScript.includes(`'${name}'`), `${name} should be registered in scripts/selftest.js`);
  });

  const helpHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help.html"), "utf8");
  const helpAdminHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/help-admin.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");
  const runHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/run.html"), "utf8");

  assert(helpHtml.includes("/ui/help-admin.html"), "general help should keep /ui/ operator faq link");
  assert(helpAdminHtml.includes("/docs/runbooks/") || helpAdminHtml.includes("runbook"), "operator faq ui should keep runbook navigation");
  assert(workspaceHtml.includes("/ui/help-admin.html"), "workspace should keep /ui/ operator faq link");
  assert(runHtml.includes("/ui/"), "run ui should keep /ui/ links");
}

module.exports = { run };
