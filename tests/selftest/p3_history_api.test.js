const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const {
  createRun,
  toPublicRunId,
  appendRunPlannedAction,
  confirmRunPlannedAction,
  appendRunExternalOperation,
  markRunRunning,
  markRunFinished,
  hashConfirmToken,
} = require("../../src/api/runs");
const { createThread, postMessage } = require("../../src/server/threadsStore");
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
      body: JSON.stringify({ name: "history-api", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "History Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const runId = createRun(db, {
      project_id: parsedProject.internalId,
      thread_id: parsedThread.internalId,
      job_type: "integration_hub.workspace.chat_turn",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/history_test.json",
      inputs: {
        requested_by: "operator-1",
        project_id: project.id,
        thread_id: thread.thread_id,
        ai_provider: "local_stub",
        external_read_plan: {
          actionability: "confirm_required",
          confirm_required: true,
          read_targets: {
            github: { repository: "octocat/hello-world", branch: "feature/history", file_paths: ["src/history.js"] },
            figma: { file_key: "figma-file-1", frame_id: "12:34" },
          },
        },
      },
    });
    createdRunIds.push(runId);
    const publicRunId = toPublicRunId(runId);

    postMessage(
      db,
      thread.thread_id,
      {
        role: "user",
        content: "history event from chat confirm_token=abc123 should redact",
        run_id: publicRunId,
      },
      "user-1"
    );

    const confirmToken = "confirm-secret-token";
    const plannedAction = appendRunPlannedAction(db, runId, {
      provider: "github",
      operation_type: "github.create_pr",
      status: "confirm_required",
      target: { repository: "octocat/hello-world", branch: "feature/history", path: "src/history.js" },
      requested_at: new Date(Date.now() - 4000).toISOString(),
      confirm_token_hash: hashConfirmToken(confirmToken),
    });
    assert(plannedAction && plannedAction.action_id, "planned action should be created");

    const confirmed = confirmRunPlannedAction(db, runId, {
      actionId: plannedAction.action_id,
      confirmToken,
      provider: "github",
      operationType: "github.create_pr",
    });
    assert(confirmed.ok, "planned action confirm should succeed");

    appendRunExternalOperation(db, runId, {
      provider: "github",
      operation_type: "github.create_pr",
      target: { repository: "octocat/hello-world", branch: "feature/history", path: "src/history.js" },
      result: { status: "ok", failure_code: null, reason: "created pr" },
      recorded_at: new Date(Date.now() - 2000).toISOString(),
      artifacts: { branch: "feature/history", pr_url: "https://github.com/octocat/hello-world/pull/1" },
    });

    assert(markRunRunning(db, runId), "run should transition to running");
    markRunFinished(db, runId, { status: "failed", failureCode: "validation_error" });

    const historyRes = await requestLocal(handler, {
      method: "GET",
      url:
        `/api/history?project_id=${encodeURIComponent(project.id)}` +
        `&thread_id=${encodeURIComponent(thread.thread_id)}` +
        `&run_id=${encodeURIComponent(publicRunId)}` +
        `&limit=20`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(historyRes.statusCode === 200, `history should return 200, got ${historyRes.statusCode}`);
    const historyBody = JSON.parse(historyRes.body.toString("utf8"));
    assert(Array.isArray(historyBody.items), "history items should be returned");
    assert(historyBody.items.length >= 7, "history should include derived minimum events");
    assert(Array.isArray(historyBody.day_groups), "history should include day_groups");
    assert(historyBody.day_groups.length >= 1, "history should include at least one day group");
    assert(Array.isArray(historyBody.run_summaries), "history should include run summaries");
    assert(historyBody.run_summaries.some((entry) => entry && entry.run_id === publicRunId), "history should include run summary for run");

    const eventTypes = historyBody.items.map((item) => item.event_type);
    assert(eventTypes.includes("run.created"), "history should include run.created");
    assert(eventTypes.includes("run.status_changed"), "history should include run.status_changed");
    assert(eventTypes.includes("read.plan_recorded"), "history should include read.plan_recorded");
    assert(eventTypes.includes("write.plan_recorded"), "history should include write.plan_recorded");
    assert(eventTypes.includes("confirm.executed"), "history should include confirm.executed");
    assert(eventTypes.includes("external_operation.recorded"), "history should include external_operation.recorded");
    assert(eventTypes.includes("audit.projected"), "history should include audit.projected");

    const runCreated = historyBody.items.find((item) => item.event_type === "run.created");
    assert(runCreated.summary && typeof runCreated.summary === "string", "event summary should exist");
    assert(runCreated.actor && runCreated.actor.requested_by === "operator-1", "actor should be included");
    assert(runCreated.related_ids && runCreated.related_ids.project_id === project.id, "related project id should be included");
    assert(runCreated.related_ids.thread_id === thread.thread_id, "related thread id should be included");
    assert(runCreated.related_ids.run_id === publicRunId, "related run id should be included");
    assert(typeof runCreated.recorded_at === "string" && runCreated.recorded_at.length > 0, "recorded_at should exist");

    const dayGroup = historyBody.day_groups[0];
    assert(typeof dayGroup.summary === "string" && dayGroup.summary.includes("events"), "day group summary should be factual");
    const runSummary = historyBody.run_summaries.find((entry) => entry && entry.run_id === publicRunId);
    assert(runSummary && typeof runSummary.summary === "string" && runSummary.summary.includes("events"), "run summary should be factual");

    const providerRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/history?project_id=${encodeURIComponent(project.id)}&provider=github&event_type=external_operation.recorded`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(providerRes.statusCode === 200, "provider filtered history should return 200");
    const providerBody = JSON.parse(providerRes.body.toString("utf8"));
    assert(providerBody.items.length === 1, "provider/event_type filter should narrow results");
    assert(providerBody.items[0].provider === "github", "provider should match");

    const statusRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/history?run_id=${encodeURIComponent(publicRunId)}&status=failed&event_type=run.status_changed`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(statusRes.statusCode === 200, "status filtered history should return 200");
    const statusBody = JSON.parse(statusRes.body.toString("utf8"));
    assert(statusBody.items.length === 1, "status filter should match failed run status event");
    assert(statusBody.items[0].status === "failed", "run status should be failed");

    const timeStart = new Date(Date.now() - 3000).toISOString();
    const timeRes = await requestLocal(handler, {
      method: "GET",
      url:
        `/api/history?run_id=${encodeURIComponent(publicRunId)}` +
        `&start_at=${encodeURIComponent(timeStart)}` +
        `&event_type=${encodeURIComponent("external_operation.recorded,confirm.executed")}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(timeRes.statusCode === 200, "time range history should return 200");
    const timeBody = JSON.parse(timeRes.body.toString("utf8"));
    assert(timeBody.items.every((item) => item.recorded_at >= timeStart), "time range should filter older events");

    const pagedRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/history?project_id=${encodeURIComponent(project.id)}&limit=2`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(pagedRes.statusCode === 200, "paged history should return 200");
    const pagedBody = JSON.parse(pagedRes.body.toString("utf8"));
    assert(pagedBody.items.length === 2, "limit should be applied");
    assert(typeof pagedBody.next_cursor === "string" && pagedBody.next_cursor.length > 0, "next cursor should be returned");

    const nextRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/history?project_id=${encodeURIComponent(project.id)}&limit=2&cursor=${encodeURIComponent(pagedBody.next_cursor)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(nextRes.statusCode === 200, "next page should return 200");
    const nextBody = JSON.parse(nextRes.body.toString("utf8"));
    assert(nextBody.items.length >= 1, "next page should return remaining items");

    const invalidEventRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/history?event_type=invalid.event",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidEventRes.statusCode === 400, "invalid event_type should return 400");
  } finally {
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
