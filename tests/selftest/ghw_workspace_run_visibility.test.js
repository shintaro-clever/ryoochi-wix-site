const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdRunIds = [];
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "gh-workspace-visibility", staging_url: "https://example.com" }),
    });
    assert(projectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(projectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const runRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/gh-visibility.json",
        inputs: {
          page_url: "https://example.com",
          external_operations: [
            {
              provider: "github",
              operation_type: "github.create_pr",
              target: { repository: "octocat/hello-world", branch: "feature/demo", path: "src/index.js" },
              result: { status: "failed", failure_code: "service_unavailable", reason: "network_unavailable" },
              artifacts: {
                branch: "feature/demo",
                commit_sha: "abc123",
                pr_url: "https://github.com/octocat/hello-world/pull/1",
                pr_number: 1,
              },
            },
          ],
        },
      }),
    });
    assert(runRes.statusCode === 201, "run create should return 201");
    const run = JSON.parse(runRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, run.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${run.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const detail = JSON.parse(runDetailRes.body.toString("utf8"));
    const githubOps = Array.isArray(detail.external_operations)
      ? detail.external_operations.filter((entry) => entry && entry.provider === "github")
      : [];
    assert(githubOps.length >= 1, "run detail should include github operation");
    assert(githubOps[0].artifacts.commit_sha === "abc123", "github commit sha should be visible in run detail");
    assert(githubOps[0].artifacts.pr_url.includes("github.com"), "github pr url should be visible in run detail");
    assert(githubOps[0].result.reason === "network_unavailable", "github failure reason should be visible in run detail");

    const projectRunsRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(projectRunsRes.statusCode === 200, "project runs should return 200");
    const projectRuns = JSON.parse(projectRunsRes.body.toString("utf8"));
    const listed = Array.isArray(projectRuns.runs) ? projectRuns.runs.find((entry) => entry.run_id === run.run_id) : null;
    assert(listed, "project runs should include created run");
    assert(Array.isArray(listed.external_operations), "project runs row should include external_operations");

    const workspaceUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-workspace.html"), "utf8");
    assert(workspaceUi.includes("GitHub:"), "workspace UI should include github operation summary text");
    const runUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/run.html"), "utf8");
    assert(runUi.includes("run-github-operations"), "run UI should include github operations section");
  } finally {
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
