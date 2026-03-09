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
const { assert, requestLocal } = require("./_helpers");

function setRunTimestamps(runId, createdAt, updatedAt = createdAt) {
  db.prepare("UPDATE runs SET created_at=?, updated_at=? WHERE tenant_id=? AND id=?").run(
    createdAt,
    updatedAt,
    DEFAULT_TENANT,
    runId
  );
}

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
      body: JSON.stringify({ name: "metrics-api", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Metrics Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const baseMs = Date.parse("2026-03-09T12:00:00.000Z");

    function makeRun({ offsetMinutes, status, score, confirm = true, withFigmaSkip = false, label }) {
      const runId = createRun(db, {
        project_id: parsedProject.internalId,
        thread_id: parsedThread.internalId,
        job_type: "integration_hub.workspace.chat_turn",
        run_mode: "mcp",
        target_path: ".ai-runs/{{run_id}}/metrics_test.json",
        inputs: {
          requested_by: "operator-2",
          project_id: project.id,
          thread_id: thread.thread_id,
          ai_provider: "local_stub",
          external_read_plan: {
            actionability: "confirm_required",
            confirm_required: true,
            read_targets: {
              github: { repository: "octocat/hello-world", branch: "feature/metrics", file_paths: ["src/app.js"] },
              figma: { file_key: "figma-file-2", frame_id: "22:44" },
            },
          },
        },
      });
      createdRunIds.push(runId);
      patchRunInputs(db, runId, {
        fidelity_score: score,
        fidelity_status: score < 95 ? "failed" : "ok",
        fidelity_evidence: {
          diff_scores: {
            final: {
              score,
              status: score < 95 ? "failed" : "ok",
            },
          },
        },
        context_used: {
          fidelity_evidence: {
            diff_scores: {
              final: {
                score,
                status: score < 95 ? "failed" : "ok",
              },
            },
          },
        },
      });

      const token = `${label}-confirm-token`;
      const plannedAction = appendRunPlannedAction(db, runId, {
        provider: "github",
        operation_type: "github.create_pr",
        status: "confirm_required",
        target: { repository: "octocat/hello-world", branch: "feature/metrics", path: "src/app.js" },
        requested_at: new Date(baseMs + offsetMinutes * 60000 - 2000).toISOString(),
        confirm_token_hash: hashConfirmToken(token),
      });
      if (confirm) {
        const confirmed = confirmRunPlannedAction(db, runId, {
          actionId: plannedAction.action_id,
          confirmToken: token,
          provider: "github",
          operationType: "github.create_pr",
        });
        assert(confirmed.ok, "planned action confirm should succeed");
      }

      appendRunExternalOperation(db, runId, {
        provider: "github",
        operation_type: "github.create_pr",
        target: { repository: "octocat/hello-world", branch: "feature/metrics", path: "src/app.js" },
        result: { status: "ok", failure_code: null, reason: "created pr" },
        recorded_at: new Date(baseMs + offsetMinutes * 60000 - 1000).toISOString(),
        artifacts: { branch: "feature/metrics", pr_url: "https://github.com/octocat/hello-world/pull/2" },
      });

      if (withFigmaSkip) {
        appendRunExternalOperation(db, runId, {
          provider: "figma",
          operation_type: "figma.apply_changes",
          target: { file_key: "figma-file-2", frame_id: "22:44" },
          result: { status: "skipped", failure_code: "validation_error", reason: "confirm_required" },
          recorded_at: new Date(baseMs + offsetMinutes * 60000).toISOString(),
          artifacts: { node_count: 2 },
        });
      }

      appendRunExternalOperation(db, runId, {
        provider: "fidelity",
        operation_type: "fidelity.corrective_action_write_plan",
        target: { path: ".ai-runs" },
        result: { status: "ok", failure_code: null, reason: status === "failed" ? "retry candidate" : "steady" },
        recorded_at: new Date(baseMs + offsetMinutes * 60000 + 1000).toISOString(),
        artifacts: { provider: "github" },
      });

      assert(markRunRunning(db, runId), "run should transition to running");
      markRunFinished(db, runId, { status, failureCode: status === "failed" ? "validation_error" : null });
      const createdAt = new Date(baseMs + offsetMinutes * 60000).toISOString();
      const updatedAt = new Date(baseMs + offsetMinutes * 60000 + 3000).toISOString();
      setRunTimestamps(runId, createdAt, updatedAt);
      return { runId, publicRunId: toPublicRunId(runId) };
    }

    const baselineA = makeRun({ offsetMinutes: 0, status: "succeeded", score: 98, label: "baseline-a" });
    const baselineB = makeRun({ offsetMinutes: 10, status: "succeeded", score: 97, label: "baseline-b" });
    const baselineC = makeRun({ offsetMinutes: 20, status: "succeeded", score: 96, label: "baseline-c" });
    const baselineD = makeRun({ offsetMinutes: 30, status: "succeeded", score: 99, label: "baseline-d" });
    const recentA = makeRun({ offsetMinutes: 40, status: "failed", score: 94, withFigmaSkip: true, label: "recent-a" });
    const recentB = makeRun({ offsetMinutes: 50, status: "failed", score: 93, label: "recent-b" });
    const recentC = makeRun({ offsetMinutes: 60, status: "failed", score: 92, label: "recent-c" });
    const recentD = makeRun({ offsetMinutes: 70, status: "failed", score: 91.5, label: "recent-d" });

    db.prepare("UPDATE runs SET failure_code=? WHERE tenant_id=? AND id=?").run(
      "secret_id=vault://github/tokens/metrics-secret",
      DEFAULT_TENANT,
      recentC.runId
    );
    appendRunExternalOperation(db, recentD.runId, {
      provider: "github",
      operation_type: "github.sync_branch",
      target: { repository: "octocat/hello-world", branch: "feature/metrics", path: "src/app.js" },
      result: {
        status: "failed",
        failure_code: "confirm_token=abc123",
        reason: "env://SECRET_METRICS_REASON",
      },
      recorded_at: new Date(baseMs + 71 * 60000).toISOString(),
      artifacts: { branch: "feature/metrics" },
    });

    postMessage(
      db,
      thread.thread_id,
      {
        role: "user",
        content: "metrics event content",
        run_id: recentD.publicRunId,
      },
      "user-2"
    );

    db.prepare("INSERT INTO audit_logs(tenant_id, actor_id, action, meta_json, created_at) VALUES(?,?,?,?,?)").run(
      DEFAULT_TENANT,
      "user-2",
      "workspace.search",
      JSON.stringify({
        actor: { id: "env://SECRET_ACTOR", role: "admin" },
        requested_by: "env://SECRET_REQUESTED_BY",
        project_id: project.id,
        thread_id: thread.thread_id,
        provider_filter: ["github"],
        scope: ["run", "external_operation"],
        recorded_at: new Date(baseMs + 75 * 60000).toISOString(),
      }),
      new Date(baseMs + 75 * 60000).toISOString()
    );

    const metricsRes = await requestLocal(handler, {
      method: "GET",
      url:
        `/api/metrics/workspace?project_id=${encodeURIComponent(project.id)}` +
        `&thread_id=${encodeURIComponent(thread.thread_id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(metricsRes.statusCode === 200, `metrics should return 200, got ${metricsRes.statusCode}`);
    const metricsText = metricsRes.body.toString("utf8");
    const metricsBody = JSON.parse(metricsRes.body.toString("utf8"));
    assert(metricsBody.project_id === project.id, "project_id should be echoed");
    assert(metricsBody.thread_id === thread.thread_id, "thread_id should be echoed");

    assert(metricsBody.run_counts.total === 8, "run count total should reflect seeded runs");
    assert(metricsBody.run_counts.by_status.failed === 4, "failed runs should be counted");
    assert(metricsBody.run_counts.by_status.ok === 4, "ok runs should be counted");
    assert(Array.isArray(metricsBody.run_counts.by_project), "by_project should be an array");
    assert(Array.isArray(metricsBody.run_counts.by_thread), "by_thread should be an array");
    assert(Array.isArray(metricsBody.run_counts.by_job_type), "by_job_type should be an array");

    assert(metricsBody.confirm_rate.total.write_plan_recorded === 8, "write plans should be counted");
    assert(metricsBody.confirm_rate.total.confirm_executed === 8, "confirm executions should be counted");
    assert(metricsBody.confirm_rate.total.pending === 0, "pending confirms should be counted");
    assert(metricsBody.confirm_rate.total.rate === 100, "confirm rate should be calculated");
    assert(
      metricsBody.confirm_rate.by_provider.some((entry) => entry.provider === "github" && entry.confirm_executed === 8),
      "confirm by provider should include github"
    );

    assert(metricsBody.operation_counts.total >= 17, "operations should be counted");
    assert(
      metricsBody.operation_counts.by_provider.some((entry) => entry.provider === "github" && entry.count >= 8),
      "operation by provider should include github"
    );
    assert(
      metricsBody.operation_counts.by_provider_and_status.some(
        (entry) => entry.provider === "figma" && entry.status === "skipped" && entry.count === 1
      ),
      "provider/status breakdown should include figma skipped"
    );

    assert(metricsBody.failure_code_distribution.total >= 5, "run and operation failures should be counted");
    assert(
      metricsBody.failure_code_distribution.by_run.some(
        (entry) => entry.run_id === recentD.publicRunId && entry.failure_code === "validation_error"
      ),
      "failure by run should include validation_error"
    );
    assert(
      metricsBody.failure_code_distribution.by_provider.some(
        (entry) => entry.provider === "figma" && entry.failure_code === "validation_error"
      ),
      "failure by provider should include figma validation_error"
    );
    assert(
      metricsBody.failure_code_distribution.by_run.some((entry) => entry.failure_code === "[redacted]"),
      "secret-like failure_code should be redacted in by_run"
    );
    assert(
      metricsBody.failure_code_distribution.by_provider.some((entry) => entry.failure_code === "[redacted]"),
      "secret-like failure_code should be redacted in by_provider"
    );
    assert(
      metricsBody.search_count.by_actor.some((entry) => entry.actor === "[redacted]"),
      "secret-like search actor should be redacted"
    );
    assert(!metricsText.includes("env://SECRET_ACTOR"), "metrics should not leak secret-like actor");
    assert(!metricsText.includes("env://SECRET_REQUESTED_BY"), "metrics should not leak requested_by secret");
    assert(!metricsText.includes("confirm_token=abc123"), "metrics should not leak confirm token");
    assert(!metricsText.includes("vault://github/tokens/metrics-secret"), "metrics should not leak secret_id ref");

    assert(metricsBody.search_count.total === 1, "search count should be included");
    assert(metricsBody.history_event_volume.total >= 40, "history event volume should include derived events for seeded runs");
    assert(metricsBody.corrective_write_plan_count.total === 8, "corrective write plan count should be included");
    assert(metricsBody.retry_count.total === 4, "retry count should be included from retry reason");
    assert(metricsBody.thread_activity.total_threads === 1, "thread activity should count active thread");
    assert(metricsBody.duration.count === 8, "duration count should be included");
    assert(metricsBody.duration.median_ms >= 0, "median duration should be non-negative");
    assert(metricsBody.duration.p95_ms >= metricsBody.duration.median_ms, "p95 should be >= median");
    assert(metricsBody.figma_fidelity_distribution.runs_with_score === 8, "fidelity score count should be included");
    assert(
      metricsBody.figma_fidelity_distribution.score_bands.some((entry) => entry.band === "80-94.99" && entry.count === 4),
      "score band should include 80-94.99"
    );
    assert(Array.isArray(metricsBody.anomalies.items), "anomaly items should exist");
    assert(metricsBody.anomalies.thresholds, "anomaly thresholds should be included");
    assert(
      metricsBody.anomalies.items.some((item) => item.code === "failed_ratio_surge" && item.severity === "alert"),
      "failed ratio surge should alert"
    );
    assert(
      metricsBody.anomalies.items.some((item) => item.code === "fidelity_below_threshold_streak" && item.severity === "alert"),
      "fidelity streak should alert"
    );
    assert(
      metricsBody.anomalies.items.some((item) => item.code === "confirm_post_failure_rate_spike" && item.severity === "alert"),
      "confirm post failure rate spike should alert"
    );

    const providerRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/metrics/workspace?project_id=${encodeURIComponent(project.id)}&provider=github`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(providerRes.statusCode === 200, "provider filtered metrics should return 200");
    const providerBody = JSON.parse(providerRes.body.toString("utf8"));
    assert(Array.isArray(providerBody.provider) && providerBody.provider[0] === "github", "provider filter should be echoed");
    assert(providerBody.run_counts.total === 8, "provider filtered run count should keep matching run");
    assert(providerBody.operation_counts.by_provider.every((entry) => entry.provider === "github"), "provider filtered operations should narrow to github");
    assert(providerBody.search_count.total === 1, "provider filtered search should match search audit provider");

    const emptyRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/metrics/workspace?project_id=${encodeURIComponent(project.id)}&start_at=${encodeURIComponent("2100-01-01T00:00:00.000Z")}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(emptyRes.statusCode === 200, "empty metrics should return 200");
    const emptyBody = JSON.parse(emptyRes.body.toString("utf8"));
    assert(emptyBody.run_counts.total === 0, "empty run count should be 0");
    assert(emptyBody.confirm_rate.total.write_plan_recorded === 0, "empty confirm metrics should stay 0");
    assert(Array.isArray(emptyBody.operation_counts.by_provider), "empty operation arrays should still exist");
    assert(emptyBody.search_count.total === 0, "empty search count should be 0");
    assert(emptyBody.history_event_volume.total === 0, "empty history event volume should be 0");
    assert(emptyBody.thread_activity.total_threads === 0, "empty thread activity should be 0");
    assert(Array.isArray(emptyBody.figma_fidelity_distribution.score_bands), "empty fidelity score bands should exist");
    assert(Array.isArray(emptyBody.anomalies.items) && emptyBody.anomalies.items.length === 0, "empty anomalies should exist");

    const invalidRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/metrics/workspace?start_at=invalid-date",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidRes.statusCode === 400, "invalid start_at should return 400");
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
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, "user-2");
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
