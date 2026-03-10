const nock = require("nock");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { executeOpenAiTextUseCase } = require("../../src/ai/openaiClient");
const { assert } = require("./_helpers");

async function run() {
  const actorId = "selftest-openai-wrapper";
  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);

    nock("https://api.openai.com")
      .post("/v1/responses")
      .reply(200, {
        output_text: "wrapped response",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
        },
      });

    const okResult = await executeOpenAiTextUseCase({
      db,
      actorId,
      tenantId: DEFAULT_TENANT,
      apiKey: "sk-test-wrapper",
      model: "gpt-5-mini",
      use_case: "summary",
      prompt: "Summarize the workspace state.",
      evidence_summary: "Workspace has 3 recent runs.",
      evidence_refs: {
        run_id: "run-001",
        thread_id: "thread-001",
        metric_snapshot: { success_rate: 98, secret_ref: "env://OPENAI_API_KEY" },
        history_window: { last_messages: 5, confirm_token: "abc123" },
        manual: [{ title: "Operator note", path: "notes/operator.md" }],
        runbook: [{ title: "Workspace Ops", path: "docs/runbooks/workspace.md", section: "verify" }],
        doc_source: [{ title: "Workflow", path: "docs/ai/core/workflow.md" }],
      },
      timeout_ms: 1000,
    });
    assert(okResult.status === "ok", "success call should return ok");
    assert(okResult.failure_code === null, "success failure_code should be null");
    assert(okResult.response === "wrapped response", "success response should be normalized");
    assert(okResult.token_usage.total_tokens === 18, "token usage should be projected");
    assert(okResult.evidence_refs.run_id === "run-001", "run_id should be preserved");
    assert(okResult.evidence_refs.thread_id === "thread-001", "thread_id should be preserved");
    assert(okResult.evidence_refs.metric_snapshot.secret_ref === "[redacted]", "metric snapshot should be sanitized");
    assert(okResult.evidence_refs.history_window.confirm_token === "[redacted]", "history window should be sanitized");
    assert(okResult.evidence_refs.manual.length === 1, "manual refs should be normalized");
    nock.cleanAll();

    nock("https://api.openai.com").post("/v1/responses").reply(429, {
      error: { message: "Rate limit reached" },
    });
    const rateLimitResult = await executeOpenAiTextUseCase({
      apiKey: "sk-test-wrapper",
      model: "gpt-5-mini",
      use_case: "analysis",
      prompt: "Analyze failures.",
      timeout_ms: 1000,
    });
    assert(rateLimitResult.status === "error", "429 should return error");
    assert(rateLimitResult.failure_code === "rate_limit", "429 should normalize to rate_limit");
    nock.cleanAll();

    nock("https://api.openai.com")
      .post("/v1/responses")
      .replyWithError({ code: "ETIMEDOUT", message: "openai_timeout" });
    const timeoutResult = await executeOpenAiTextUseCase({
      apiKey: "sk-test-wrapper",
      model: "gpt-5-mini",
      use_case: "translation",
      prompt: "Translate this.",
      timeout_ms: 10,
    });
    assert(timeoutResult.status === "error", "timeout should return error");
    assert(timeoutResult.failure_code === "timeout", "timeout should normalize to timeout");
    nock.cleanAll();

    nock("https://api.openai.com")
      .post("/v1/responses")
      .replyWithError({ code: "ECONNRESET", message: "socket hang up" });
    const connectionResult = await executeOpenAiTextUseCase({
      apiKey: "sk-test-wrapper",
      model: "gpt-5-mini",
      use_case: "faq",
      prompt: "Answer faq.",
      timeout_ms: 1000,
    });
    assert(connectionResult.status === "error", "connection failure should return error");
    assert(connectionResult.failure_code === "connection_failed", "connection failure should normalize");
    nock.cleanAll();

    const auditRows = db
      .prepare("SELECT action, meta_json FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, actorId);
    assert(auditRows.length >= 1, "wrapper should record audit log");
    assert(auditRows.some((row) => row.action === "ai.requested"), "wrapper should record ai.requested");
    assert(auditRows.some((row) => row.action === "ai.completed"), "wrapper should record ai.completed");
    assert(auditRows.some((row) => row.action === "ai.failed"), "wrapper should record ai.failed");
    assert(auditRows.some((row) => row.action === "openai.assist.call"), "wrapper should use openai audit action");
    const requestedRow = auditRows.find((row) => row.action === "ai.requested");
    const requestedMeta = JSON.parse((requestedRow && requestedRow.meta_json) || "{}");
    assert(requestedMeta.evidence_refs_summary.run_id === "run-001", "audit should store evidence summary only");
    assert(!JSON.stringify(requestedMeta).includes("abc123"), "audit should not store raw secret-like evidence");
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
  }
}

module.exports = { run };
