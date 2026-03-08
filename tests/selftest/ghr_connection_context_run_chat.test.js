const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevGithubToken = process.env.GH_CTX_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.GH_CTX_TOKEN = "ghu_ctx_token";

  const createdProjectIds = [];
  const createdRunIds = [];
  const createdThreadIds = [];

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
      body: JSON.stringify({ name: "gh-ctx-run-chat", staging_url: "https://example.com" }),
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
        github_default_path: "docs",
        github_secret_id: "env://GH_CTX_TOKEN",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "project settings put should return 200");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .times(3)
      .reply(200, {
        full_name: "octocat/hello-world",
        default_branch: "main",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
      })
      .get("/repos/octocat/hello-world/commits/main")
      .times(3)
      .reply(200, {
        sha: "sha-ctx-main",
        commit: {
          message: "ctx commit",
          author: { name: "The Octocat", date: "2026-03-08T00:00:00Z" },
        },
        html_url: "https://github.com/octocat/hello-world/commit/sha-ctx-main",
      });

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/gh-context-run.json",
        github_ref: "main",
        github_file_paths: ["README.md", "src/index.js"],
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunRes.statusCode === 201, "run create should return 201");
    const createdRun = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, createdRun.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    const runGithubContext = runDetail.inputs?.connection_context?.github;
    assert(runGithubContext, "run should include connection_context.github");
    assert(runGithubContext.branch === "main", "run github context branch should be main");
    assert(runGithubContext.latest_commit_sha === "sha-ctx-main", "run github latest_commit_sha should match");
    assert(runGithubContext.repository_metadata.full_name === "octocat/hello-world", "run github repository metadata should match");
    assert(Array.isArray(runGithubContext.file_paths) && runGithubContext.file_paths.length === 2, "run github file paths should be normalized");
    assert(runGithubContext.selection_source.path === "run_override", "run override path should take precedence");
    assert(runGithubContext.selection_source.branch === "run_override", "run override branch should take precedence");
    assert(runDetail.context_used?.connection_context?.github?.latest_commit_sha === "sha-ctx-main", "context_used should include github latest_commit_sha");
    assert(runDetail.external_references_snapshot?.github?.repository === "octocat/hello-world", "github snapshot repository should be stored");
    assert(runDetail.external_references_snapshot?.github?.branch === "main", "github snapshot branch should be stored");
    assert(runDetail.external_references_snapshot?.github?.latest_commit_sha === "sha-ctx-main", "github snapshot commit should be stored");
    assert(
      Array.isArray(runDetail.external_references_snapshot?.github?.resolved_target_paths) &&
        runDetail.external_references_snapshot.github.resolved_target_paths.includes("README.md"),
      "github snapshot should include resolved target paths"
    );

    const createRunDefaultRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/gh-context-default.json",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunDefaultRes.statusCode === 201, "default-target run create should return 201");
    const defaultRun = JSON.parse(createRunDefaultRes.body.toString("utf8"));
    const parsedDefaultRun = parsePublicIdFor(KINDS.run, defaultRun.run_id);
    assert(parsedDefaultRun.ok, "default run id should be public");
    createdRunIds.push(parsedDefaultRun.internalId);

    const defaultRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${defaultRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(defaultRunDetailRes.statusCode === 200, "default-target run detail should return 200");
    const defaultRunDetail = JSON.parse(defaultRunDetailRes.body.toString("utf8"));
    const defaultGithubContext = defaultRunDetail.inputs?.connection_context?.github;
    assert(defaultGithubContext, "default-target run should include github context");
    assert(defaultGithubContext.selection_source.path === "project_default", "project default path should be used");
    assert(defaultGithubContext.file_paths.length === 1 && defaultGithubContext.file_paths[0] === "docs", "project default path should be applied");
    assert(defaultGithubContext.selection_source.branch === "project_default", "project default branch should be used");

    const workspaceRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({
        content: "check github context",
        github_ref: "main",
        github_file_paths: ["README.md"],
      }),
    });
    assert(workspaceRes.statusCode === 201, "workspace message should return 201");
    const workspaceBody = JSON.parse(workspaceRes.body.toString("utf8"));
    const parsedWorkspaceRun = parsePublicIdFor(KINDS.run, workspaceBody.run_id);
    const parsedWorkspaceThread = parsePublicIdFor(KINDS.thread, workspaceBody.thread_id);
    assert(parsedWorkspaceRun.ok, "workspace run id should be public");
    assert(parsedWorkspaceThread.ok, "workspace thread id should be public");
    createdRunIds.push(parsedWorkspaceRun.internalId);
    createdThreadIds.push(parsedWorkspaceThread.internalId);

    const workspaceRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${workspaceBody.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(workspaceRunDetailRes.statusCode === 200, "workspace run detail should return 200");
    const workspaceRunDetail = JSON.parse(workspaceRunDetailRes.body.toString("utf8"));
    const workspaceGithubContext = workspaceRunDetail.inputs?.connection_context?.github;
    assert(workspaceGithubContext, "workspace run should include connection_context.github");
    assert(workspaceGithubContext.branch === "main", "workspace github context branch should be main");
    assert(workspaceGithubContext.latest_commit_sha === "sha-ctx-main", "workspace github latest_commit_sha should match");
    assert(Array.isArray(workspaceGithubContext.file_paths) && workspaceGithubContext.file_paths[0] === "README.md", "workspace github file path should be passed");
    assert(
      workspaceRunDetail.external_references_snapshot?.github?.resolved_target_paths?.[0] === "README.md",
      "workspace run should store github resolved target path"
    );
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
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
    if (prevGithubToken === undefined) delete process.env.GH_CTX_TOKEN;
    else process.env.GH_CTX_TOKEN = prevGithubToken;
  }
}

module.exports = { run };
