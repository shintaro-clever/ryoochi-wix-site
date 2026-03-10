const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createProject } = require("../../src/api/projects");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
const { createRun, patchRunInputs, markRunFinished, toPublicRunId } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-summary";

  const userId = `u-${crypto.randomUUID()}`;
  let projectId = "";
  let runId = "";
  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
    const project = createProject(
      db,
      "Summary Test Project",
      "https://example.com",
      userId
    );
    projectId = project.id;
    const aiSetting = createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    runId = createRun(db, {
      project_id: projectId,
      thread_id: crypto.randomUUID(),
      ai_setting_id: aiSetting.ai_setting_id,
      job_type: "integration_hub.phase2.project_run",
      run_mode: "mcp",
      inputs: {
        external_operations: [
          {
            provider: "github",
            operation_type: "write.plan",
            target: { branch: "feature/test" },
            result: { status: "error", reason: "pull request validation failed", failure_code: "invalid_request" },
          },
          {
            provider: "figma",
            operation_type: "write.plan",
            target: { page_id: "1:1", frame_id: "2:2" },
            artifacts: { fidelity_score: 82.5, figma_node_ids: ["3:3"] },
            result: { status: "error", reason: "structure drift detected", failure_code: "conflict" },
          },
        ],
        figma_structure_diff: {
          major_diff_detected: true,
          structural_reproduction: { rate: 0.72, pass: false, status: "failed" },
          counts: { target_mismatches: 2, text_mismatches: 1 },
        },
        figma_visual_diff: {
          score: 82.5,
          highlights: ["button spacing changed"],
        },
      },
    });
    patchRunInputs(db, runId, {
      external_operations: [
        {
          provider: "github",
          operation_type: "write.plan",
          target: { branch: "feature/test" },
          result: { status: "error", reason: "pull request validation failed", failure_code: "invalid_request" },
        },
      ],
    });
    markRunFinished(db, runId, { status: "failed", failureCode: "service_unavailable" });

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
          overview: "Run failed after GitHub and Figma validation issues were detected.",
          main_failure_reasons: ["GitHub validation failed", "Figma structure drift detected"],
          priority_actions: ["Inspect the failing validation checks", "Review the Figma diff before retry"],
        }),
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      });

    const response = await requestLocal(handler, {
      method: "POST",
      url: `/api/runs/${encodeURIComponent(toPublicRunId(runId))}/ai-summary`,
      headers: authz,
      body: JSON.stringify({}),
    });
    assert(response.statusCode === 200, `summary should return 200, got ${response.statusCode}`);
    const payload = JSON.parse(response.body.toString("utf8"));
    assert(payload.status === "ok", "summary status should be ok");
    assert(payload.summary.overview.includes("Run failed"), "summary overview should come back");
    assert(payload.summary.main_failure_reasons.length === 2, "summary reasons should be returned");
    assert(payload.summary.priority_actions.length === 2, "summary actions should be returned");
    assert(payload.evidence_refs.run_id === toPublicRunId(runId), "evidence should include run_id");
    assert(payload.evidence_refs.thread_id && payload.evidence_refs.metric_snapshot, "evidence refs should include required fields");
    assert(payload.evidence_refs.doc_source.length >= 1, "doc sources should be attached");
    const auditRows = db
      .prepare("SELECT action, meta_json FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, userId);
    assert(auditRows.some((row) => row.action === "summary.generated"), "summary api should record summary.generated");
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
    if (runId) {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);
    }
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (projectId) {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, projectId);
    }
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
