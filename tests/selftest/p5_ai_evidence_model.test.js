const { assert } = require("./_helpers");
const { buildEvidenceRefs, evidenceRefsToSummary } = require("../../src/ai/aiEvidenceModel");

async function run() {
  const refs = buildEvidenceRefs({
    run_id: "run-123",
    thread_id: "thread-123",
    metric_snapshot: {
      failure_rate: 0.1,
      owner_email: "user@example.com",
      secret_ref: "env://OPENAI_API_KEY",
    },
    history_window: {
      recent_messages: 8,
      confirm_token: "abc123",
    },
    manual: [{ title: "Operator Memo", path: "docs/manual.md", section: "handoff" }],
    runbook: [{ title: "Recovery", path: "docs/runbooks/recovery.md" }],
    doc_source: [{ title: "Workflow", path: "docs/ai/core/workflow.md" }],
  });

  assert(refs.run_id === "run-123", "run_id should be preserved");
  assert(refs.thread_id === "thread-123", "thread_id should be preserved");
  assert(refs.metric_snapshot.failure_rate === 0.1, "metric snapshot number should be preserved");
  assert(refs.metric_snapshot.owner_email === "[redacted_pii]", "metric snapshot pii should be redacted");
  assert(refs.metric_snapshot.secret_ref === "[redacted]", "metric snapshot secret should be redacted");
  assert(refs.history_window.confirm_token === "[redacted]", "history window token should be redacted");
  assert(refs.manual.length === 1, "manual refs should be normalized");
  assert(refs.runbook.length === 1, "runbook refs should be normalized");
  assert(refs.doc_source.length === 1, "doc refs should be normalized");

  const summary = evidenceRefsToSummary(refs);
  assert(summary.includes("run_id: run-123"), "summary should include run_id");
  assert(summary.includes("\"owner_email\":\"[redacted_pii]\""), "summary should use sanitized values");
  assert(!summary.includes("user@example.com"), "summary should not include raw pii");
}

module.exports = { run };
