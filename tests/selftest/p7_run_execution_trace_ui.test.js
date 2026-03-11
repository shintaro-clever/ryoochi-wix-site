"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const runHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/run.html"), "utf8");

  assert(runHtml.includes("Execution Trace"), "run UI should render execution trace section");
  assert(runHtml.includes("run-related-write-plans"), "run UI should render related write plans container");
  assert(runHtml.includes("run-related-execution-plans"), "run UI should render related execution plans container");
  assert(runHtml.includes("run-related-execution-jobs"), "run UI should render related execution jobs container");
  assert(runHtml.includes("/ui/write-plans.html"), "run UI should link to write-plan detail");
  assert(runHtml.includes("/ui/execution-plan-confirm.html"), "run UI should link to execution confirm");
}

module.exports = { run };
