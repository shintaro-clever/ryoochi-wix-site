const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { KINDS, parsePublicIdFor } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevFigmaToken = process.env.FG_CHATX_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.FG_CHATX_TOKEN = "figma_chatx_token";

  const createdProjectIds = [];
  const createdThreadIds = [];
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
      body: JSON.stringify({ name: "chatx-confirm", staging_url: "https://example.com" }),
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
        github_secret_id: "vault://github/tokens/chatx-confirm",
        github_operation_mode: "controlled_write",
        github_allowed_branches: "feature/*",
        figma_file_key: "CutkQD2XudkCe8eJ1jDfkZ",
        figma_secret_id: "vault://figma/tokens/chatx-confirm",
        figma_page_scope: "page_id:1:1",
        figma_frame_scope: "frame_id:11:22",
        figma_writable_scope: "frame",
        figma_operation_mode: "controlled_write",
        figma_allowed_frame_scope: "frame_id:11:22",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "settings put should return 200");

    const createThreadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "ChatX Confirm Thread" }),
    });
    assert(createThreadRes.statusCode === 201, "thread create should return 201");
    const thread = JSON.parse(createThreadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    createdThreadIds.push(parsedThread.internalId);

    const ghPlanRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({
        content: "GitHub に src/index.js を更新してください",
        write: {
          provider: "github",
          head_branch: "feature/chatx-gh",
          file_path: "src/index.js",
          file_content: "console.log('chatx');\n",
          github_token: "dummy-token",
          create_pr: false,
        },
      }),
    });
    assert(ghPlanRes.statusCode === 201, "github chat plan should return 201");
    const ghPlan = JSON.parse(ghPlanRes.body.toString("utf8"));
    const ghRun = parsePublicIdFor(KINDS.run, ghPlan.run_id);
    assert(ghRun.ok, "github run id should be public");
    createdRunIds.push(ghRun.internalId);
    assert(ghPlan.orchestration && ghPlan.orchestration.write_plan, "github write plan should be returned");
    const ghWritePlan = ghPlan.orchestration.write_plan;
    assert(ghWritePlan.planned_action && ghWritePlan.confirm_token, "github planned action token should exist");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world/git/ref/heads/main")
      .reply(200, { object: { sha: "base-sha-gh-chatx" } })
      .post("/repos/octocat/hello-world/git/refs")
      .reply(201, { ref: "refs/heads/feature/chatx-gh", object: { sha: "base-sha-gh-chatx" } })
      .put("/repos/octocat/hello-world/contents/src/index.js")
      .reply(201, { commit: { sha: "commit-gh-chatx-1" } });

    const ghConfirmRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({
        content: "confirm github write",
        run_id: ghPlan.run_id,
        write: {
          provider: "github",
          confirm: true,
          planned_action_id: ghWritePlan.planned_action.action_id,
          confirm_token: ghWritePlan.confirm_token,
          head_branch: "feature/chatx-gh",
          file_path: "src/index.js",
          file_content: "console.log('chatx');\n",
          github_token: "dummy-token",
          create_pr: false,
        },
      }),
    });
    assert(ghConfirmRes.statusCode === 201, "github confirm should return 201");
    const ghConfirm = JSON.parse(ghConfirmRes.body.toString("utf8"));
    assert(ghConfirm.status === "succeeded", "github confirm should succeed");
    assert(ghConfirm.orchestration && ghConfirm.orchestration.write_execution, "github write execution result should be returned");

    const ghRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${ghPlan.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(ghRunDetailRes.statusCode === 200, "github run detail should return 200");
    const ghRunDetail = JSON.parse(ghRunDetailRes.body.toString("utf8"));
    const ghOps = Array.isArray(ghRunDetail.external_operations)
      ? ghRunDetail.external_operations.filter((entry) => entry && entry.provider === "github")
      : [];
    assert(ghOps.some((entry) => entry.operation_type === "github.write_plan"), "run should keep github write plan");
    assert(ghOps.some((entry) => entry.operation_type === "github.create_pr" && entry.result?.status === "ok"), "run should keep github actual result");

    const fgPlanRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({
        content: "Figma のテキストを更新してください",
        page_id: "1:1",
        frame_id: "11:22",
        write: {
          provider: "figma",
          page_id: "1:1",
          frame_id: "11:22",
          node_id: "11:22:node1",
          change_type: "text_update",
          text: "chatx figma",
        },
      }),
    });
    assert(fgPlanRes.statusCode === 201, "figma chat plan should return 201");
    const fgPlan = JSON.parse(fgPlanRes.body.toString("utf8"));
    const fgRun = parsePublicIdFor(KINDS.run, fgPlan.run_id);
    assert(fgRun.ok, "figma run id should be public");
    createdRunIds.push(fgRun.internalId);
    const fgWritePlan = fgPlan.orchestration && fgPlan.orchestration.write_plan;
    assert(fgWritePlan && fgWritePlan.planned_action && fgWritePlan.confirm_token, "figma planned action token should exist");

    nock("https://api.figma.com")
      .get("/v1/files/CutkQD2XudkCe8eJ1jDfkZ")
      .times(2)
      .reply(200, {
        version: "fg-chatx-v1",
        lastModified: "2026-03-01T00:00:00Z",
      })
      .post("/v1/files/CutkQD2XudkCe8eJ1jDfkZ/nodes:batch_update")
      .reply(200, {
        version: "fg-chatx-v2",
        lastModified: "2026-03-08T00:00:00Z",
        updated_node_ids: ["11:22:node1"],
      });

    const fgConfirmRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({
        content: "confirm figma write",
        run_id: fgPlan.run_id,
        write: {
          provider: "figma",
          confirm: true,
          planned_action_id: fgWritePlan.planned_action.action_id,
          confirm_token: fgWritePlan.confirm_token,
          page_id: "1:1",
          frame_id: "11:22",
          node_id: "11:22:node1",
          change_type: "text_update",
          text: "chatx figma",
          figma_secret_id: "env://FG_CHATX_TOKEN",
        },
      }),
    });
    assert(fgConfirmRes.statusCode === 201, "figma confirm should return 201");
    const fgConfirm = JSON.parse(fgConfirmRes.body.toString("utf8"));
    assert(fgConfirm.status === "succeeded", "figma confirm should succeed");
    assert(fgConfirm.orchestration && fgConfirm.orchestration.write_execution, "figma write execution result should be returned");

    const fgRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${fgPlan.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(fgRunDetailRes.statusCode === 200, "figma run detail should return 200");
    const fgRunDetail = JSON.parse(fgRunDetailRes.body.toString("utf8"));
    const fgOps = Array.isArray(fgRunDetail.external_operations)
      ? fgRunDetail.external_operations.filter((entry) => entry && entry.provider === "figma")
      : [];
    assert(fgOps.some((entry) => entry.operation_type === "figma.write_plan"), "run should keep figma write plan");
    assert(fgOps.some((entry) => entry.operation_type === "figma.apply_changes" && entry.result?.status === "ok"), "run should keep figma actual result");
    assert(fgRunDetail.figma_before_after && fgRunDetail.figma_before_after.before && fgRunDetail.figma_before_after.after, "run should keep figma before/after");
    assert(
      fgRunDetail.inputs &&
        fgRunDetail.inputs.fg_validation &&
        (fgRunDetail.inputs.fg_validation.status === "ok" || fgRunDetail.inputs.fg_validation.status === "failed"),
      "run should keep figma fidelity result"
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
    if (prevFigmaToken === undefined) delete process.env.FG_CHATX_TOKEN;
    else process.env.FG_CHATX_TOKEN = prevFigmaToken;
  }
}

module.exports = { run };
