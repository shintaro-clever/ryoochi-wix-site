const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createProject } = require("../../src/api/projects");
const {
  createRun,
  appendRunPlannedAction,
  confirmRunPlannedAction,
  appendRunExternalOperation,
  markRunRunning,
  markRunFinished,
  hashConfirmToken,
  patchRunInputs,
} = require("../../src/api/runs");
const { createThread } = require("../../src/server/threadsStore");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
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
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-analysis";

  const userId = `u-${crypto.randomUUID()}`;
  let projectId = "";
  const createdRunIds = [];
  let threadInternalId = "";
  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
    const project = createProject(db, "AI Analysis Project", "https://example.com", userId);
    projectId = project.id;
    const thread = createThread(db, projectId, "AI Analysis Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    threadInternalId = parsedThread.internalId;
    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    const baseMs = Date.parse("2026-03-09T12:00:00.000Z");
    function makeRun({ offsetMinutes, status, score, confirm = true, label }) {
      const runId = createRun(db, {
        project_id: projectId,
        thread_id: threadInternalId,
        job_type: "integration_hub.workspace.chat_turn",
        run_mode: "mcp",
        target_path: ".ai-runs/{{run_id}}/analysis_test.json",
        inputs: {
          project_id: `project_${projectId}`,
          thread_id: thread.thread_id,
          ai_provider: "openai",
          fidelity_score: score,
        },
      });
      createdRunIds.push(runId);
      patchRunInputs(db, runId, {
        fidelity_score: score,
        fidelity_status: score < 95 ? "failed" : "ok",
      });
      const token = `${label}-confirm-token`;
      const plannedAction = appendRunPlannedAction(db, runId, {
        provider: "github",
        operation_type: "github.create_pr",
        status: "confirm_required",
        target: { repository: "octocat/hello-world", branch: "feature/analysis" },
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
        target: { repository: "octocat/hello-world", branch: "feature/analysis" },
        result: { status: status === "failed" ? "failed" : "ok", failure_code: status === "failed" ? "validation_error" : null },
        recorded_at: new Date(baseMs + offsetMinutes * 60000 - 1000).toISOString(),
        artifacts: { branch: "feature/analysis" },
      });
      assert(markRunRunning(db, runId), "run should transition to running");
      markRunFinished(db, runId, { status, failureCode: status === "failed" ? "validation_error" : null });
      const createdAt = new Date(baseMs + offsetMinutes * 60000).toISOString();
      const updatedAt = new Date(baseMs + offsetMinutes * 60000 + 3000).toISOString();
      setRunTimestamps(runId, createdAt, updatedAt);
    }

    makeRun({ offsetMinutes: 0, status: "succeeded", score: 98, label: "baseline-a" });
    makeRun({ offsetMinutes: 10, status: "succeeded", score: 97, label: "baseline-b" });
    makeRun({ offsetMinutes: 20, status: "succeeded", score: 96, label: "baseline-c" });
    makeRun({ offsetMinutes: 30, status: "succeeded", score: 99, label: "baseline-d" });
    makeRun({ offsetMinutes: 40, status: "failed", score: 94, label: "recent-a" });
    makeRun({ offsetMinutes: 50, status: "failed", score: 93, label: "recent-b" });
    makeRun({ offsetMinutes: 60, status: "failed", score: 92, label: "recent-c" });
    makeRun({ offsetMinutes: 70, status: "failed", score: 91, label: "recent-d" });

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    nock("https://api.openai.com")
      .post("/v1/responses")
      .times(3)
      .reply(200, (_uri, reqBody) => {
        const body = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
        const inputText = JSON.stringify(body);
        assert(!inputText.includes("confirm_token"), "analysis request should not leak confirm token");
        return {
          output_text: JSON.stringify({
            candidate_causes: ["recent failure pattern changed", "top provider failure code repeated"],
            impact_scope: ["recent runs impacted", "operator retry decisions impacted"],
            additional_checks: ["compare recent run summaries", "inspect provider failure code distribution"],
          }),
          usage: { input_tokens: 15, output_tokens: 12, total_tokens: 27 },
        };
      });

    for (const alertCode of [
      "failed_ratio_surge",
      "fidelity_below_threshold_streak",
      "confirm_post_failure_rate_spike",
    ]) {
      const res = await requestLocal(handler, {
        method: "POST",
        url: "/api/ai-analysis/observability",
        headers: authz,
        body: JSON.stringify({
          project_id: `project_${projectId}`,
          thread_id: thread.thread_id,
          alert_code: alertCode,
        }),
      });
      assert(res.statusCode === 200, `${alertCode} should return 200, got ${res.statusCode}`);
      const response = JSON.parse(res.body.toString("utf8"));
      assert(response.use_case === "observability_analysis", "analysis use_case should match");
      assert(response.alert_code === alertCode, "alert code should echo selected alert");
      assert(Array.isArray(response.analysis.candidate_causes) && response.analysis.candidate_causes.length > 0, "candidate causes should exist");
      assert(Array.isArray(response.analysis.impact_scope) && response.analysis.impact_scope.length > 0, "impact scope should exist");
      assert(Array.isArray(response.analysis.additional_checks) && response.analysis.additional_checks.length > 0, "additional checks should exist");
      assert(response.evidence_refs.metric_snapshot.analyzed_alert_code === alertCode, "evidence should include analyzed alert code");
    }
    const auditRows = db
      .prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, userId);
    assert(auditRows.some((row) => row.action === "analysis.generated"), "analysis api should record analysis.generated");
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (threadInternalId) {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, threadInternalId);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, threadInternalId);
    }
    if (projectId) db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, projectId);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiApiKey;
  }
}

module.exports = { run };
