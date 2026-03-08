const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { KINDS, parsePublicIdFor } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdThreadIds = [];
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
      body: JSON.stringify({ name: "chatx-read-plan", staging_url: "https://example.com" }),
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
        github_secret_id: "vault://github/tokens/chatx",
        figma_file_key: "CutkQD2XudkCe8eJ1jDfkZ",
        figma_secret_id: "vault://figma/tokens/chatx",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "settings put should return 200");

    const createThreadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "ChatX Thread" }),
    });
    assert(createThreadRes.statusCode === 201, "thread create should return 201");
    const thread = JSON.parse(createThreadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    createdThreadIds.push(parsedThread.internalId);

    const ambiguousChatRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({ content: "Figmaを更新してください" }),
    });
    assert(ambiguousChatRes.statusCode === 201, "ambiguous chat should return 201");
    const ambiguousChat = JSON.parse(ambiguousChatRes.body.toString("utf8"));
    const ambiguousRun = parsePublicIdFor(KINDS.run, ambiguousChat.run_id);
    assert(ambiguousRun.ok, "ambiguous run id should be public");
    createdRunIds.push(ambiguousRun.internalId);
    assert(ambiguousChat.orchestration && ambiguousChat.orchestration.confirm_required === true, "ambiguous target should require confirm");
    assert(
      typeof ambiguousChat.orchestration.confirm_required_reason === "string" &&
        ambiguousChat.orchestration.confirm_required_reason.includes("ambiguous_figma_target"),
      "ambiguous figma reason should be surfaced"
    );

    const ambiguousRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${ambiguousChat.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(ambiguousRunDetailRes.statusCode === 200, "ambiguous run detail should return 200");
    const ambiguousRunDetail = JSON.parse(ambiguousRunDetailRes.body.toString("utf8"));
    assert(
      ambiguousRunDetail.inputs &&
        ambiguousRunDetail.inputs.external_read_plan &&
        ambiguousRunDetail.inputs.external_read_plan.actionability === "confirm_required",
      "run inputs should include external read plan with confirm_required"
    );
    assert(
      ambiguousRunDetail.inputs.external_read_plan.read_targets &&
        ambiguousRunDetail.inputs.external_read_plan.read_targets.figma &&
        ambiguousRunDetail.inputs.external_read_plan.read_targets.figma.file_key === "CutkQD2XudkCe8eJ1jDfkZ",
      "run inputs should store figma read target"
    );

    const threadDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${thread.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(threadDetailRes.statusCode === 200, "thread detail should return 200");
    const threadDetail = JSON.parse(threadDetailRes.body.toString("utf8"));
    const assistantMessage = threadDetail.thread.messages.find((m) => m.message_id === ambiguousChat.assistant_message_id);
    assert(assistantMessage && /confirm required/i.test(String(assistantMessage.content || "")), "assistant should explain confirm-required stop");

    const explicitChatRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({
        content: "Figmaを更新してください",
        page_id: "1:1",
        frame_id: "11:22",
        figma_node_ids: ["11:22:node1"],
      }),
    });
    assert(explicitChatRes.statusCode === 201, "explicit chat should return 201");
    const explicitChat = JSON.parse(explicitChatRes.body.toString("utf8"));
    const explicitRun = parsePublicIdFor(KINDS.run, explicitChat.run_id);
    assert(explicitRun.ok, "explicit run id should be public");
    createdRunIds.push(explicitRun.internalId);
    assert(
      explicitChat.orchestration &&
        explicitChat.orchestration.confirm_required === false &&
        explicitChat.orchestration.actionability === "ready",
      "explicit targets should be ready"
    );
  } finally {
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
  }
}

module.exports = { run };
