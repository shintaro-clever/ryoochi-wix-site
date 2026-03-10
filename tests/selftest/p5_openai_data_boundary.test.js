const nock = require("nock");
const { assert } = require("./_helpers");
const { executeOpenAiTextUseCase } = require("../../src/ai/openaiClient");
const { sanitizeSecretLikeText, sanitizeOpenAiText } = require("../../src/ai/openaiDataBoundary");

async function run() {
  assert(
    sanitizeSecretLikeText("confirm_token=abc123 secret_id=vault://sec/path") === "[redacted] [redacted]",
    "secret sanitizer should redact confirm_token and secret_id"
  );
  assert(
    sanitizeOpenAiText('{"type":"RUN_STATUS_CHANGED","actor":{"userId":"u1"},"meta":{"confirm_token":"abc"}}') === "[redacted_audit]",
    "raw audit text should be blocked"
  );
  assert(
    sanitizeOpenAiText("Contact user@example.com or +1 555-111-2222") === "Contact [redacted_pii] or [redacted_pii]",
    "pii should be redacted"
  );

  let capturedBody = null;
  nock("https://api.openai.com")
    .post("/v1/responses", (body) => {
      capturedBody = body;
      return true;
    })
    .reply(200, { output_text: "ok", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });

  const result = await executeOpenAiTextUseCase({
    apiKey: "sk-test-wrapper",
    model: "gpt-5-mini",
    use_case: "summary",
    prompt: "summarize confirm_token=abc123 and env://OPENAI_API_KEY and jane@example.com",
    evidence_summary: '{"type":"RUN_STATUS_CHANGED","actor":{"userId":"u1"},"meta":{"secret_id":"vault://x"}}',
    evidence_refs: {
      run_id: "run-xyz",
      metric_snapshot: {
        secret_ref: "env://OPENAI_API_KEY",
        owner_email: "jane@example.com",
      },
      history_window: {
        confirm_token: "abc123",
      },
      runbook: [{ title: "Private", path: "vault://runbook/private" }],
    },
    timeout_ms: 1000,
  });
  assert(result.status === "ok", "sanitized wrapper call should succeed");
  assert(result.evidence_refs.metric_snapshot.secret_ref === "[redacted]", "result evidence refs should be sanitized");
  assert(result.evidence_refs.metric_snapshot.owner_email === "[redacted_pii]", "pii evidence should be sanitized");
  assert(capturedBody && typeof capturedBody.input === "string", "request body should be captured");
  assert(!capturedBody.input.includes("abc123"), "confirm token should not be sent");
  assert(!capturedBody.input.includes("env://OPENAI_API_KEY"), "secret ref should not be sent");
  assert(!capturedBody.input.includes("jane@example.com"), "email should not be sent");
  assert(capturedBody.input.includes("[redacted]"), "secret-like values should be redacted");
  assert(capturedBody.input.includes("[redacted_pii]"), "pii should be redacted");
  assert(capturedBody.input.includes("[redacted_audit]"), "audit raw text should be redacted");
  nock.cleanAll();
}

module.exports = { run };
