"use strict";

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
      body: JSON.stringify({ name: "p3-secret-masking", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Mask Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const runId = createRun(db, {
      project_id: parsedProject.internalId,
      thread_id: parsedThread.internalId,
      job_type: "integration_hub.workspace.chat_turn",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/p3_mask_test.json",
      inputs: {
        requested_by: "mask-operator",
        project_id: project.id,
        thread_id: thread.thread_id,
        ai_provider: "local_stub",
        content: "mask fixture secret=supersecret",
      },
    });
    createdRunIds.push(runId);
    const publicRunId = toPublicRunId(runId);

    postMessage(
      db,
      thread.thread_id,
      {
        role: "user",
        content: "mask me env://SECRET_PATH confirm_token=abc123 github_pat_secret_should_not_leak",
        run_id: publicRunId,
      },
      "mask-user"
    );

    const confirmToken = "mask-confirm-token";
    const confirmTokenHash = hashConfirmToken(confirmToken);
    const plannedAction = appendRunPlannedAction(db, runId, {
      provider: "github",
      operation_type: "github.create_pr",
      status: "confirm_required",
      target: { repository: "octocat/hello-world", branch: "feature/mask", path: "src/mask.js" },
      requested_at: new Date(Date.now() - 4000).toISOString(),
      confirm_token_hash: hashConfirmToken(confirmToken),
    });
    assert(plannedAction && plannedAction.action_id, "planned action should exist");

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
      target: { repository: "octocat/hello-world", branch: "feature/mask", path: "src/mask.js" },
      result: {
        status: "failed",
        failure_code: "validation_error",
        reason: "token=ghp_secret_should_not_leak confirm_token=abc123 env://SECRET_PATH",
      },
      recorded_at: new Date(Date.now() - 1000).toISOString(),
      artifacts: { branch: "feature/mask" },
    });

    assert(markRunRunning(db, runId), "run should transition to running");
    markRunFinished(db, runId, { status: "failed", failureCode: "validation_error" });

    const searchRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/workspace/search",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        thread_id: thread.thread_id,
        query: "mask",
        scope: ["message", "external_operation"],
        limit: 20,
      }),
    });
    assert(searchRes.statusCode === 200, "workspace search should return 200");
    const searchText = searchRes.body.toString("utf8");
    assert(!searchText.includes("env://SECRET_PATH"), "workspace search should redact env secret refs");
    assert(!searchText.includes("confirm_token=abc123"), "workspace search should redact confirm token");
    assert(!searchText.includes("github_pat_secret_should_not_leak"), "workspace search should redact token-like text");
    assert(!searchText.includes("ghp_secret_should_not_leak"), "workspace search should redact operation token-like text");

    const historyRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/history?run_id=${encodeURIComponent(publicRunId)}&limit=20`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(historyRes.statusCode === 200, "history should return 200");
    const historyText = historyRes.body.toString("utf8");
    assert(!historyText.includes("env://SECRET_PATH"), "history should redact env secret refs");
    assert(!historyText.includes("confirm_token=abc123"), "history should redact confirm token");
    assert(!historyText.includes(confirmTokenHash), "history should not leak confirm token hash");
    assert(!historyText.includes("github_pat_secret_should_not_leak"), "history should redact token-like text");
    assert(!historyText.includes("ghp_secret_should_not_leak"), "history should redact operation token-like text");

    const exportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "history",
        format: "json",
        project_id: project.id,
        thread_id: thread.thread_id,
        run_id: publicRunId,
        limit: 50,
      }),
    });
    assert(exportRes.statusCode === 200, "history export should return 200");
    const exportText = exportRes.body.toString("utf8");
    assert(!exportText.includes("env://SECRET_PATH"), "history export should redact env secret refs");
    assert(!exportText.includes("confirm_token=abc123"), "history export should redact confirm token");
    assert(!exportText.includes(confirmTokenHash), "history export should not leak confirm token hash");
    assert(!exportText.includes("github_pat_secret_should_not_leak"), "history export should redact token-like text");
    assert(!exportText.includes("ghp_secret_should_not_leak"), "history export should redact operation token-like text");

    const auditRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "audit",
        format: "json",
        project_id: project.id,
        thread_id: thread.thread_id,
        run_id: publicRunId,
      }),
    });
    assert(auditRes.statusCode === 200, "audit export should return 200");
    const auditText = auditRes.body.toString("utf8");
    assert(!auditText.includes("mask-confirm-token"), "audit export should not leak confirm token");
    assert(!auditText.includes(confirmTokenHash), "audit export should not leak confirm token hash");

    const metricsRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/metrics/workspace?project_id=${encodeURIComponent(project.id)}&thread_id=${encodeURIComponent(thread.thread_id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(metricsRes.statusCode === 200, "metrics should return 200");
    const metricsText = metricsRes.body.toString("utf8");
    assert(!metricsText.includes("env://SECRET_PATH"), "metrics should redact env secret refs");
    assert(!metricsText.includes("confirm_token=abc123"), "metrics should redact confirm token");
    assert(!metricsText.includes(confirmTokenHash), "metrics should not leak confirm token hash");
    assert(!metricsText.includes("github_pat_secret_should_not_leak"), "metrics should redact token-like text");
    assert(!metricsText.includes("ghp_secret_should_not_leak"), "metrics should redact operation token-like text");

    const metricsExportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "metrics",
        format: "json",
        project_id: project.id,
        thread_id: thread.thread_id,
      }),
    });
    assert(metricsExportRes.statusCode === 200, "metrics export should return 200");
    const metricsExportText = metricsExportRes.body.toString("utf8");
    assert(!metricsExportText.includes("env://SECRET_PATH"), "metrics export should redact env secret refs");
    assert(!metricsExportText.includes("confirm_token=abc123"), "metrics export should redact confirm token");
    assert(!metricsExportText.includes(confirmTokenHash), "metrics export should not leak confirm token hash");
    assert(!metricsExportText.includes("github_pat_secret_should_not_leak"), "metrics export should redact token-like text");
    assert(!metricsExportText.includes("ghp_secret_should_not_leak"), "metrics export should redact operation token-like text");
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
