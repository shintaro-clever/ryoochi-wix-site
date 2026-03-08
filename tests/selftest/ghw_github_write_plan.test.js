const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { parseRunIdInput } = require("../../src/api/runs");
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

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "gh-write-plan", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const putSettingsRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        github_default_branch: "main",
        github_secret_id: "vault://github/tokens/ghw-01",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "project settings put should return 200");

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/gh-write-plan.json",
        github_ref: "main",
        github_file_paths: ["src/index.js"],
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunRes.statusCode === 201, "run create should return 201");
    const createdRun = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parseRunIdInput(createdRun.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const planRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: createdRun.run_id,
        head_branch: "feature/gh-write-plan",
        changes: [
          {
            path: "src/index.js",
            content_before: "const a = 1;\n",
            content_after: "const a = 2;\n",
          },
          {
            path: "docs/new.md",
            action: "create",
            content_after: "# New\n",
          },
        ],
      }),
    });
    assert(planRes.statusCode === 201, "github write plan should return 201");
    const plan = JSON.parse(planRes.body.toString("utf8"));
    assert(plan.operation_type === "github.create_pr", "operation_type should be create_pr");
    assert(plan.target_branch === "feature/gh-write-plan", "target branch should match");
    assert(Array.isArray(plan.read_paths) && plan.read_paths.includes("src/index.js"), "read paths should be included");
    assert(Array.isArray(plan.write_paths) && plan.write_paths.length === 2, "write paths should include planned files");
    assert(plan.path_match === "mismatch", "path match should detect mismatch for unread write path");
    assert(Array.isArray(plan.changes) && plan.changes.length === 2, "changes should be returned");
    assert(plan.changes[0].change_type === "update", "change type should be detected");
    assert(typeof plan.changes[0].diff_summary?.summary === "string", "diff summary should be returned");
    assert(plan.planned_action && typeof plan.planned_action.action_id === "string", "planned action should be returned");
    assert(typeof plan.confirm_token === "string" && plan.confirm_token.length > 10, "confirm token should be returned");
    assert(typeof plan.confirm_required_reason === "string" && plan.confirm_required_reason.length > 0, "confirm reason should exist");
    assert(plan.expected_artifacts && plan.expected_artifacts.branch === "feature/gh-write-plan", "expected artifacts should include branch");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(
      Array.isArray(runDetail.planned_actions) &&
        runDetail.planned_actions.some((entry) => entry && entry.operation_type === "github.create_pr"),
      "planned action should be tracked on run"
    );
    assert(
      Array.isArray(runDetail.external_operations) &&
        runDetail.external_operations.some((entry) => entry && entry.operation_type === "github.write_plan"),
      "write plan operation should be tracked on run"
    );
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
