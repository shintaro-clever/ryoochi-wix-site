const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
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
    nock.disableNetConnect();
    nock.enableNetConnect("127.0.0.1");

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
      body: JSON.stringify({ name: "gh-controlled-write", staging_url: "https://example.com" }),
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
        github_default_path: "src",
        github_secret_id: "vault://github/tokens/ghw-02",
        github_operation_mode: "controlled_write",
        github_allowed_branches: "main,feature/*",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "settings put should return 200");

    const runCreateRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/gh-write.json",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(runCreateRes.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreateRes.body.toString("utf8"));
    const parsedRun = parseRunIdInput(runPayload.run_id);
    assert(parsedRun.ok, "run id should be valid");
    createdRunIds.push(parsedRun.internalId);

    const disallowedPathRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "octocat",
        repo: "hello-world",
        title: "blocked path",
        github_token: "dummy-token",
        dry_run: false,
        file_path: "docs/blocked.md",
        head_branch: "feature/blocked",
      }),
    });
    assert(disallowedPathRes.statusCode === 400, "path outside project scope should be rejected");

    const defaultBranchPlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "octocat",
        repo: "hello-world",
        title: "default-branch-plan",
        github_token: "dummy-token",
        dry_run: false,
        file_path: "src/index.js",
        head_branch: "main",
      }),
    });
    assert(defaultBranchPlanRes.statusCode === 202, "default branch request should still require confirm first");
    const defaultBranchPlan = JSON.parse(defaultBranchPlanRes.body.toString("utf8"));
    const defaultBranchConfirmRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "octocat",
        repo: "hello-world",
        title: "default-branch-plan",
        github_token: "dummy-token",
        dry_run: false,
        file_path: "src/index.js",
        head_branch: "main",
        confirm: true,
        planned_action_id: defaultBranchPlan.planned_action.action_id,
        confirm_token: defaultBranchPlan.confirm_token,
      }),
    });
    assert(defaultBranchConfirmRes.statusCode === 400, "default branch direct push must be rejected");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world/git/ref/heads/main")
      .reply(200, { object: { sha: "base-sha-01" } })
      .post("/repos/octocat/hello-world/git/refs")
      .reply(201, { ref: "refs/heads/feature/ghw-02", object: { sha: "base-sha-01" } })
      .put("/repos/octocat/hello-world/contents/src/index.js")
      .reply(201, { commit: { sha: "commit-sha-123" } });

    const writePlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "octocat",
        repo: "hello-world",
        title: "controlled-write",
        github_token: "dummy-token",
        dry_run: false,
        create_pr: false,
        file_path: "src/index.js",
        file_content: "console.log('updated');\n",
        head_branch: "feature/ghw-02",
      }),
    });
    assert(writePlanRes.statusCode === 202, "write should be confirm-required before execution");
    const writePlan = JSON.parse(writePlanRes.body.toString("utf8"));
    assert(writePlan.status === "confirm_required", "status should be confirm_required");

    const writeConfirmRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "octocat",
        repo: "hello-world",
        title: "controlled-write",
        github_token: "dummy-token",
        dry_run: false,
        create_pr: false,
        file_path: "src/index.js",
        file_content: "console.log('updated');\n",
        head_branch: "feature/ghw-02",
        confirm: true,
        planned_action_id: writePlan.planned_action.action_id,
        confirm_token: writePlan.confirm_token,
      }),
    });
    assert(writeConfirmRes.statusCode === 201, "confirmed controlled write should return 201");
    const writePayload = JSON.parse(writeConfirmRes.body.toString("utf8"));
    assert(writePayload.status === "committed", "status should be committed when create_pr=false");
    assert(writePayload.commit_sha === "commit-sha-123", "commit sha should be returned");
    assert(writePayload.pr_url === null, "pr_url should be null when create_pr=false");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    const writeOps = Array.isArray(runDetail.external_operations)
      ? runDetail.external_operations.filter((entry) => entry && entry.provider === "github" && entry.operation_type === "github.create_pr")
      : [];
    assert(writeOps.some((entry) => entry.result && entry.result.status === "ok"), "successful github write operation should be tracked");
    assert(
      writeOps.some((entry) => entry.artifacts && entry.artifacts.commit_sha === "commit-sha-123"),
      "commit artifact should be tracked"
    );
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
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
