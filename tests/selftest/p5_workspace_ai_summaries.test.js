const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createProject } = require("../../src/api/projects");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
const { createRun, markRunFinished } = require("../../src/api/runs");
const { KINDS, buildPublicId } = require("../../src/id/publicIds");
const { recordRunEvent } = require("../../src/db/runEvents");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-workspace";

  const userId = `u-${crypto.randomUUID()}`;
  let projectId = "";
  const threadId = crypto.randomUUID();
  let runId = "";
  try {
    const project = createProject(db, "Workspace Summary Project", "https://example.com", userId);
    projectId = project.id;
    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    runId = createRun(db, {
      project_id: projectId,
      thread_id: threadId,
      job_type: "integration_hub.phase2.project_run",
      run_mode: "mcp",
      inputs: {
        external_operations: [
          {
            provider: "github",
            operation_type: "write.plan",
            result: { status: "error", reason: "branch protection blocked", failure_code: "conflict" },
          },
        ],
      },
    });
    markRunFinished(db, runId, { status: "failed", failureCode: "service_unavailable" });
    recordRunEvent({ runId, eventType: "run_created" });
    recordRunEvent({ runId, eventType: "run_failed" });

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
      .reply(200, {
        output_text: JSON.stringify({
          overview: "History shows repeated failed run transitions in the selected workspace window.",
          main_failure_reasons: ["failed run status changes", "GitHub branch protection blocked writes"],
          priority_actions: ["Open the failed run summary", "Compare the recent run pattern before retrying"],
        }),
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })
      .post("/v1/responses")
      .reply(200, {
        output_text: JSON.stringify({
          overview: "Observability shows failed runs and alert conditions that need operator review.",
          main_failure_reasons: ["failed run count elevated", "alerting anomaly present"],
          priority_actions: ["Review the top alert", "Check the dominant failure code before retry"],
        }),
        usage: { input_tokens: 12, output_tokens: 12, total_tokens: 24 },
      });

    const historyRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-summary/history",
      headers: authz,
      body: JSON.stringify({
        project_id: buildPublicId(KINDS.project, projectId),
        thread_id: buildPublicId(KINDS.thread, threadId),
      }),
    });
    assert(historyRes.statusCode === 200, `history summary should return 200, got ${historyRes.statusCode}`);
    const historyBody = JSON.parse(historyRes.body.toString("utf8"));
    assert(historyBody.use_case === "history_summary", "history summary use_case should match");
    assert(historyBody.summary.overview.includes("History"), "history summary should include overview");
    assert(historyBody.evidence_refs.thread_id === buildPublicId(KINDS.thread, threadId), "history evidence should preserve thread_id");

    const obsRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-summary/observability",
      headers: authz,
      body: JSON.stringify({
        project_id: buildPublicId(KINDS.project, projectId),
        thread_id: buildPublicId(KINDS.thread, threadId),
      }),
    });
    assert(obsRes.statusCode === 200, `observability summary should return 200, got ${obsRes.statusCode}`);
    const obsBody = JSON.parse(obsRes.body.toString("utf8"));
    assert(obsBody.use_case === "observability_summary", "observability use_case should match");
    assert(obsBody.summary.overview.includes("Observability"), "observability summary should include overview");
    assert(obsBody.evidence_refs.metric_snapshot.total_runs >= 1, "observability evidence should include metrics");
  } finally {
    nock.cleanAll();
    if (runId) db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
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
