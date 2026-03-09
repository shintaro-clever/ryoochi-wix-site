const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const {
  createRun,
  toPublicRunId,
  appendRunPlannedAction,
  markRunRunning,
  markRunFinished,
} = require("../../src/api/runs");
const { createThread } = require("../../src/server/threadsStore");
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
      body: JSON.stringify({ name: "run-retry-api", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Retry Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    function seedRun(status) {
      const runId = createRun(db, {
        project_id: parsedProject.internalId,
        thread_id: parsedThread.internalId,
        job_type: "integration_hub.workspace.chat_turn",
        run_mode: "mcp",
        target_path: ".ai-runs/{{run_id}}/retry_test.json",
        inputs: {
          project_id: project.id,
          thread_id: thread.thread_id,
          requested_by: "operator-3",
          content: `retry source ${status}`,
          write: {
            provider: "github",
            path: "src/retry.js",
            confirm: true,
            planned_action_id: "planned-action-id",
            confirm_token: "secret-confirm-token",
          },
          external_read_plan: {
            actionability: "confirm_required",
            confirm_required: true,
            read_targets: {
              github: { repository: "octocat/hello-world", branch: "feature/retry", file_paths: ["src/retry.js"] },
            },
          },
        },
      });
      createdRunIds.push(runId);
      appendRunPlannedAction(db, runId, {
        provider: "github",
        operation_type: "github.create_pr",
        status: "confirm_required",
        target: { repository: "octocat/hello-world", branch: "feature/retry", path: "src/retry.js" },
      });
      assert(markRunRunning(db, runId), "run should transition to running");
      markRunFinished(db, runId, { status, failureCode: status === "failed" ? "validation_error" : null });
      return toPublicRunId(runId);
    }

    const successfulSourceRunId = seedRun("succeeded");
    const failedSourceRunId = seedRun("failed");

    const readOnlyRetryRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/runs/${encodeURIComponent(successfulSourceRunId)}/retry`,
      headers: authz,
      body: JSON.stringify({ retry_kind: "read_only" }),
    });
    assert(readOnlyRetryRes.statusCode === 201, "read_only retry should return 201");
    const readOnlyRetryBody = JSON.parse(readOnlyRetryRes.body.toString("utf8"));
    assert(readOnlyRetryBody.source_run_id === successfulSourceRunId, "source run id should be echoed");
    assert(readOnlyRetryBody.retry_kind === "read_only", "retry kind should be read_only");
    assert(readOnlyRetryBody.safety.confirm_required_write_stripped === true, "read_only retry should strip write replay");
    createdRunIds.push(parsePublicIdFor(KINDS.run, readOnlyRetryBody.retry_run_id).internalId);

    const readOnlyDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${encodeURIComponent(readOnlyRetryBody.retry_run_id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(readOnlyDetailRes.statusCode === 200, "retried run detail should return 200");
    const readOnlyDetail = JSON.parse(readOnlyDetailRes.body.toString("utf8"));
    assert(readOnlyDetail.retry_of_run_id === successfulSourceRunId, "retried run should track source run");
    assert(readOnlyDetail.retry_kind === "read_only", "retried run should track retry kind");
    assert(!readOnlyDetail.inputs.write, "read_only retry should not carry write payload");
    assert(Array.isArray(readOnlyDetail.planned_actions) && readOnlyDetail.planned_actions.length === 0, "planned actions should be reset");
    assert(Array.isArray(readOnlyDetail.external_operations) && readOnlyDetail.external_operations.length === 0, "external operations should be reset");

    const failedRetryRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/runs/${encodeURIComponent(failedSourceRunId)}/retry`,
      headers: authz,
      body: JSON.stringify({ retry_kind: "failed_run" }),
    });
    assert(failedRetryRes.statusCode === 201, "failed_run retry should return 201");
    const failedRetryBody = JSON.parse(failedRetryRes.body.toString("utf8"));
    assert(failedRetryBody.retry_kind === "failed_run", "retry kind should be failed_run");
    assert(failedRetryBody.safety.write_execution_replayed === false, "failed retry should not replay writes");
    createdRunIds.push(parsePublicIdFor(KINDS.run, failedRetryBody.retry_run_id).internalId);

    const failedRetryDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${encodeURIComponent(failedRetryBody.retry_run_id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(failedRetryDetailRes.statusCode === 200, "failed retried run detail should return 200");
    const failedRetryDetail = JSON.parse(failedRetryDetailRes.body.toString("utf8"));
    assert(failedRetryDetail.retry_of_run_id === failedSourceRunId, "failed retried run should track source run");
    assert(failedRetryDetail.retry_kind === "failed_run", "failed retried run should track retry kind");
    assert(failedRetryDetail.inputs.write && failedRetryDetail.inputs.write.provider === "github", "failed retry may preserve write target");
    assert(!failedRetryDetail.inputs.write.confirm, "failed retry should strip confirm flag");
    assert(!failedRetryDetail.inputs.write.confirm_token, "failed retry should strip confirm token");
    assert(!failedRetryDetail.inputs.write.planned_action_id, "failed retry should strip planned action id");

    const failedSourceDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${encodeURIComponent(failedSourceRunId)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(failedSourceDetailRes.statusCode === 200, "source run detail should return 200");
    const failedSourceDetail = JSON.parse(failedSourceDetailRes.body.toString("utf8"));
    assert(
      Array.isArray(failedSourceDetail.retry_children) &&
        failedSourceDetail.retry_children.some((item) => item.run_id === failedRetryBody.retry_run_id),
      "source run should expose retry child relation"
    );

    const conflictRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/runs/${encodeURIComponent(successfulSourceRunId)}/retry`,
      headers: authz,
      body: JSON.stringify({ retry_kind: "failed_run" }),
    });
    assert(conflictRes.statusCode === 409, "failed_run retry on succeeded source should return 409");

    const invalidRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/runs/${encodeURIComponent(successfulSourceRunId)}/retry`,
      headers: authz,
      body: JSON.stringify({ retry_kind: "unknown" }),
    });
    assert(invalidRes.statusCode === 400, "invalid retry_kind should return 400");
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

module.exports = {
  run,
};
