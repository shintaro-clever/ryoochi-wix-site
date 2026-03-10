const { executeOpenAiTextUseCase } = require("./openaiClient");

const SUPPORTED_ALERT_CODES = Object.freeze([
  "failed_ratio_surge",
  "fidelity_below_threshold_streak",
  "confirm_post_failure_rate_spike",
]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value, max = 4) {
  const items = Array.isArray(value) ? value : [];
  return items.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, max);
}

function toJsonCandidate(text) {
  const source = normalizeText(text);
  if (!source) return "";
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) return source.slice(start, end + 1);
  return source;
}

function parseAnalysisBody(text, fallback = {}) {
  const candidate = toJsonCandidate(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        candidate_causes: safeArray(parsed.candidate_causes || fallback.candidate_causes),
        impact_scope: safeArray(parsed.impact_scope || fallback.impact_scope),
        additional_checks: safeArray(parsed.additional_checks || fallback.additional_checks),
      };
    } catch {}
  }
  return {
    candidate_causes: safeArray(fallback.candidate_causes),
    impact_scope: safeArray(fallback.impact_scope),
    additional_checks: safeArray(fallback.additional_checks),
  };
}

function buildFallbackAnalysis(alert, payload) {
  const metrics = alert && typeof alert.metrics === "object" ? alert.metrics : {};
  const topFailureCodes =
    Array.isArray(payload && payload.failure_code_distribution && payload.failure_code_distribution.by_provider)
      ? payload.failure_code_distribution.by_provider.slice(0, 3)
      : [];
  const topProviders =
    Array.isArray(payload && payload.operation_counts && payload.operation_counts.by_provider)
      ? payload.operation_counts.by_provider.slice(0, 3)
      : [];
  const anomalySummary = `${normalizeText(alert && alert.summary) || "anomaly detected"}`;

  if (alert.code === "failed_ratio_surge") {
    return {
      candidate_causes: safeArray([
        `${anomalySummary}. Recent failed rate is above baseline, which often means a new recurring failure mode entered the latest run window.`,
        topFailureCodes[0]
          ? `Top failure code candidate: ${normalizeText(topFailureCodes[0].failure_code)} on ${normalizeText(topFailureCodes[0].provider)}.`
          : "",
        topProviders[0] ? `Operator traffic may be concentrated on ${normalizeText(topProviders[0].provider)} in the current window.` : "",
      ]),
      impact_scope: safeArray([
        `Recent failed runs: ${Number(metrics.recent_failed_runs || 0)}/${Number(metrics.recent_total_runs || 0)}.`,
        "Run reliability and retry decisions are affected before controlled write actions are attempted.",
        "The current workspace window may hide whether the issue is thread-local or project-wide, so compare nearby threads.",
      ]),
      additional_checks: safeArray([
        "Check the top failure codes and providers in observability before retrying the latest failed run.",
        "Open matching run summaries to confirm whether the same failure reason repeats across the recent window.",
        "Compare baseline and recent history to see whether the surge aligns with a new provider path or workflow step.",
      ]),
    };
  }
  if (alert.code === "fidelity_below_threshold_streak") {
    return {
      candidate_causes: safeArray([
        `${anomalySummary}. Consecutive low scores usually indicate repeated quality regressions rather than a one-off run failure.`,
        "A shared prompt, context, or implementation path may be keeping fidelity below the threshold across recent runs.",
        topFailureCodes[0]
          ? `A recurring failure code may be correlated with the low-fidelity streak: ${normalizeText(topFailureCodes[0].failure_code)}.`
          : "",
      ]),
      impact_scope: safeArray([
        `Low-score streak length: ${Number(metrics.streak || 0)} runs.`,
        "Output quality and operator confidence are degraded even when runs complete.",
        "If the same thread is affected repeatedly, the issue may be rooted in shared context or repeated correction attempts.",
      ]),
      additional_checks: safeArray([
        "Compare recent run summaries and fidelity evidence to confirm which runs share the same degradation pattern.",
        "Check whether low scores cluster on the same provider, branch, or Figma scope before changing thresholds.",
        "Review recent corrective or retry patterns to see whether they improved completion but not fidelity.",
      ]),
    };
  }
  return {
    candidate_causes: safeArray([
      `${anomalySummary}. Confirmed runs are failing more often than the earlier baseline, which suggests the write-confirm path changed risk materially.`,
      topFailureCodes[0]
        ? `Most visible failure code after confirm: ${normalizeText(topFailureCodes[0].failure_code)} on ${normalizeText(topFailureCodes[0].provider)}.`
        : "",
      "A mismatch between read validation and confirmed write execution may be surfacing only after operators approve the action.",
    ]),
    impact_scope: safeArray([
      `Recent confirmed failed runs: ${Number(metrics.recent_failed_runs || 0)}/${Number(metrics.recent_total_runs || 0)}.`,
      "Confirmed write operations and post-confirm operator trust are directly affected.",
      "The blast radius may span every provider participating in confirmed write paths during the selected window.",
    ]),
    additional_checks: safeArray([
      "Inspect confirmed runs and compare their failure codes with pre-confirm history before changing write policy.",
      "Check whether the spike is limited to one provider or operation type in the by-provider metrics.",
      "Review the latest confirmed run summaries to see whether failures started after a specific workflow or configuration change.",
    ]),
  };
}

function buildEvidenceRefs({ payload, filters, alert }) {
  const anomalies =
    Array.isArray(payload && payload.anomalies && payload.anomalies.items) ? payload.anomalies.items : [];
  const failureCodes =
    Array.isArray(payload && payload.failure_code_distribution && payload.failure_code_distribution.by_provider)
      ? payload.failure_code_distribution.by_provider
      : [];
  return {
    run_id: "",
    thread_id: normalizeText(filters.thread_id),
    metric_snapshot: {
      total_runs: Number(payload && payload.run_counts ? payload.run_counts.total : 0) || 0,
      failed_runs: Number(payload && payload.run_counts && payload.run_counts.by_status ? payload.run_counts.by_status.failed : 0) || 0,
      anomaly_count: anomalies.length,
      analyzed_alert_code: normalizeText(alert && alert.code),
      analyzed_alert_severity: normalizeText(alert && alert.severity),
    },
    history_window: {
      project_id: normalizeText(filters.project_id),
      provider: safeArray(filters.provider || [], 5),
      start_at: normalizeText(filters.start_at),
      end_at: normalizeText(filters.end_at),
      alert_summary: normalizeText(alert && alert.summary),
      top_failure_codes: failureCodes.slice(0, 5).map((item) => normalizeText(item && item.failure_code)).filter(Boolean),
    },
    manual: [],
    runbook: [
      { title: "Phase5 Boundary", path: "docs/ai/core/workflow.md" },
      { title: "AI Evidence Model", path: "docs/ai/core/ai-evidence-model.md" },
    ],
    doc_source: [{ title: "Workspace Observability Model", path: "docs/ai/core/observability-model.md" }],
  };
}

function buildEvidenceSummary({ payload, alert }) {
  return JSON.stringify({
    alert,
    run_counts: payload && payload.run_counts ? payload.run_counts : {},
    anomalies: payload && payload.anomalies ? payload.anomalies : {},
    failure_code_distribution: payload && payload.failure_code_distribution ? payload.failure_code_distribution : {},
    operation_counts: payload && payload.operation_counts ? payload.operation_counts : {},
    figma_fidelity_distribution: payload && payload.figma_fidelity_distribution ? payload.figma_fidelity_distribution : {},
  });
}

async function generateObservabilityAnalysis({ db = null, actorId = "", tenantId, apiKey, model, payload, filters = {}, alert } = {}) {
  const evidenceRefs = buildEvidenceRefs({ payload, filters, alert });
  const fallbackAnalysis = buildFallbackAnalysis(alert, payload);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "observability_analysis",
    prompt:
      'Analyze the selected observability alert for an operator. Do not give a definitive diagnosis. Return JSON only. Schema: {"candidate_causes":["string"],"impact_scope":["string"],"additional_checks":["string"]}',
    evidence_summary: buildEvidenceSummary({ payload, alert }),
    evidence_refs: evidenceRefs,
  });
  return {
    provider: result.provider,
    model: result.model,
    use_case: result.use_case,
    status: result.status,
    error: result.error,
    failure_code: result.failure_code,
    latency_ms: result.latency_ms,
    token_usage: result.token_usage,
    alert_code: normalizeText(alert && alert.code),
    alert_title: normalizeText(alert && alert.title),
    alert_severity: normalizeText(alert && alert.severity),
    analysis: result.status === "ok" ? parseAnalysisBody(result.response, fallbackAnalysis) : fallbackAnalysis,
    evidence_refs: result.evidence_refs || evidenceRefs,
  };
}

module.exports = {
  SUPPORTED_ALERT_CODES,
  generateObservabilityAnalysis,
};
