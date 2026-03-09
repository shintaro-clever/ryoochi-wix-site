const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const compareUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-fidelity-compare.html"), "utf8");
  assert(compareUi.includes("Fidelity Before / After"), "compare page title should exist");
  assert(compareUi.includes("Figma 側 Before / After"), "figma before/after section should exist");
  assert(compareUi.includes("実画面側 Before / After"), "screen before/after section should exist");
  assert(compareUi.includes("compare-diff-summary"), "diff summary table should exist");
  assert(compareUi.includes("target-nodes"), "target node section should exist");
  assert(compareUi.includes("run / commit / url"), "run/commit/url section should exist");
  assert(compareUi.includes("compare-artifacts"), "artifact section should exist");
  assert(compareUi.includes("apiGet(`/runs/${encodeURIComponent(runId)}`)"), "compare page should call run detail API");

  const fidelityUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-fidelity.html"), "utf8");
  assert(
    fidelityUi.includes("/ui/project-fidelity-compare.html?project_id=${encodeURIComponent(projectId)}&run_id=${encodeURIComponent(row.run_id || \"\")}"),
    "fidelity dashboard recent failures should link compare page"
  );
}

module.exports = { run };
