const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const fidelityUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-fidelity.html"), "utf8");
  assert(fidelityUi.includes("Fidelity Dashboard"), "fidelity dashboard title should exist");
  assert(fidelityUi.includes("fidelity-target-table"), "target score table should exist");
  assert(fidelityUi.includes("fidelity-reason-dist"), "reason distribution section should exist");
  assert(fidelityUi.includes("fidelity-recent-failures"), "recent failures section should exist");
  assert(fidelityUi.includes("fidelity-env-table"), "environment diff table should exist");
  assert(fidelityUi.includes("kpi-below-95-rate"), "below 95 rate KPI should exist");
  assert(fidelityUi.includes("fidelity-top-reasons"), "top reasons section should exist");
  assert(fidelityUi.includes("fidelity-component-table"), "component failure rate table should exist");
  assert(fidelityUi.includes("/projects/${encodeURIComponent(projectId)}/runs"), "dashboard should load project runs API");

  const projectUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project.html"), "utf8");
  assert(projectUi.includes("/ui/project-fidelity.html"), "project overview should link fidelity dashboard");

  const workspaceUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-workspace.html"), "utf8");
  assert(workspaceUi.includes("workspace-fidelity-link"), "workspace should include fidelity dashboard link");
}

module.exports = { run };
