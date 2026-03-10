const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const runHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/run.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");

  assert(runHtml.includes("run-ai-corrective-generate"), "run UI should include corrective suggestion trigger");
  assert(runHtml.includes("data-run-corrective-write-plan-button"), "run UI should include corrective write-plan buttons");
  assert(runHtml.includes("confirm_required"), "run UI should render confirm_required");
  assert(runHtml.includes("evidence:"), "run UI should render evidence summary");

  assert(workspaceHtml.includes("data-run-ai-corrective-button"), "workspace UI should include corrective suggestion trigger");
  assert(workspaceHtml.includes("data-run-corrective-write-plan-button"), "workspace UI should include corrective write-plan buttons");
  assert(workspaceHtml.includes("AI corrective"), "workspace UI should label corrective suggestion area");
  assert(workspaceHtml.includes("confirm_required="), "workspace UI should render confirm_required");
}

module.exports = { run };
