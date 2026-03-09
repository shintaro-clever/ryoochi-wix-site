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
  patchRunInputs,
} = require("../../src/api/runs");
const { createThread, postMessage } = require("../../src/server/threadsStore");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const {
  SEARCH_COLUMNS,
  HISTORY_COLUMNS,
  AUDIT_COLUMNS,
  METRICS_COLUMNS,
} = require("../../src/server/routes/workspaceExport");
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
      body: JSON.stringify({ name: "workspace-export", staging_url: "https://example.com/export" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Export Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const runId = createRun(db, {
      project_id: parsedProject.internalId,
      thread_id: parsedThread.internalId,
      job_type: "integration_hub.workspace.chat_turn",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/export_test.json",
      inputs: {
        requested_by: "operator-export",
        project_id: project.id,
        thread_id: thread.thread_id,
        ai_provider: "local_stub",
        external_read_plan: {
          actionability: "confirm_required",
          confirm_required: true,
          read_targets: {
            github: { repository: "octocat/hello-world", branch: "feature/export", file_paths: ["src/export.js"] },
            figma: { file_key: "figma-file-export", frame_id: "44:55" },
          },
        },
      },
    });
    createdRunIds.push(runId);
    const publicRunId = toPublicRunId(runId);

    patchRunInputs(db, runId, {
      fidelity_score: 96,
      fidelity_status: "ok",
      fidelity_evidence: {
        diff_scores: {
          final: {
            score: 96,
            status: "ok",
          },
        },
      },
    });

    postMessage(
      db,
      thread.thread_id,
      {
        role: "user",
        content: "export search token=topsecret confirm_token=abc123 should redact",
        run_id: publicRunId,
      },
      "user-export"
    );

    const confirmToken = "confirm-secret-token";
    const plannedAction = appendRunPlannedAction(db, runId, {
      provider: "github",
      operation_type: "github.create_pr",
      status: "confirm_required",
      target: { repository: "octocat/hello-world", branch: "feature/export", path: "src/export.js" },
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
      target: { repository: "octocat/hello-world", branch: "feature/export", path: "src/export.js" },
      result: { status: "ok", failure_code: null, reason: "created pr" },
      recorded_at: new Date(Date.now() - 2000).toISOString(),
      artifacts: { branch: "feature/export", pr_url: "https://github.com/octocat/hello-world/pull/3" },
    });

    assert(markRunRunning(db, runId), "run should transition to running");
    markRunFinished(db, runId, { status: "failed", failureCode: "validation_error" });

    const searchExportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "search",
        format: "json",
        project_id: project.id,
        thread_id: thread.thread_id,
        query: "export search",
        scope: ["message", "run", "external_operation", "external_audit"],
        limit: 50,
      }),
    });
    assert(searchExportRes.statusCode === 200, "search export should return 200");
    assert(
      String(searchExportRes.headers["content-disposition"] || "").includes("workspace-search-export.json"),
      "search export should return json filename"
    );
    const searchBody = JSON.parse(searchExportRes.body.toString("utf8"));
    assert(searchBody.kind === "search", "search export kind should match");
    assert(JSON.stringify(searchBody.columns) === JSON.stringify(SEARCH_COLUMNS), "search export columns should be fixed");
    assert(Array.isArray(searchBody.items), "search export items should be an array");
    assert(searchBody.items.some((item) => item.thread_id === thread.thread_id), "search export should include thread-scoped rows");
    assert(!searchExportRes.body.toString("utf8").includes("topsecret"), "search export should not leak token values");
    assert(!searchExportRes.body.toString("utf8").includes("abc123"), "search export should redact confirm token");

    const historyExportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "history",
        format: "csv",
        project_id: project.id,
        thread_id: thread.thread_id,
        run_id: publicRunId,
        limit: 50,
      }),
    });
    assert(historyExportRes.statusCode === 200, "history export should return 200");
    assert(
      String(historyExportRes.headers["content-type"] || "").includes("text/csv"),
      "history export should return csv"
    );
    const historyText = historyExportRes.body.toString("utf8");
    assert(historyText.split("\n")[0] === HISTORY_COLUMNS.join(","), "history export header order should be fixed");
    assert(historyText.includes("run.created"), "history export should contain history rows");
    assert(!historyText.includes("abc123"), "history export should redact confirm token");
    assert(!historyText.includes("topsecret"), "history export should not leak search token");

    const auditExportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "audit",
        format: "json",
        project_id: project.id,
        thread_id: thread.thread_id,
        run_id: publicRunId,
        limit: 50,
      }),
    });
    assert(auditExportRes.statusCode === 200, "audit export should return 200");
    const auditBody = JSON.parse(auditExportRes.body.toString("utf8"));
    assert(auditBody.kind === "audit", "audit export kind should match");
    assert(JSON.stringify(auditBody.columns) === JSON.stringify(AUDIT_COLUMNS), "audit export columns should be fixed");
    assert(Array.isArray(auditBody.items), "audit export items should be an array");
    assert(auditBody.items.length === 1, "audit export should contain selected run");
    assert(auditBody.items[0].run_id === publicRunId, "audit export should include public run id");
    assert(!auditExportRes.body.toString("utf8").includes("confirm-secret-token"), "audit export should not leak confirm token");

    const metricsExportRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/exports/workspace",
      headers: authz,
      body: JSON.stringify({
        kind: "metrics",
        format: "csv",
        project_id: project.id,
        thread_id: thread.thread_id,
        provider: ["github"],
      }),
    });
    assert(metricsExportRes.statusCode === 200, "metrics export should return 200");
    const metricsText = metricsExportRes.body.toString("utf8");
    assert(metricsText.split("\n")[0] === METRICS_COLUMNS.join(","), "metrics export header order should be fixed");
    assert(metricsText.includes("run_counts,total"), "metrics export should include run counts rows");
    assert(metricsText.includes("duration,median_ms"), "metrics export should include duration rows");
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
