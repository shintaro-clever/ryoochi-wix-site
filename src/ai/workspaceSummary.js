const { executeOpenAiTextUseCase } = require("./openaiClient");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value, max = 3) {
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

function parseSummaryBody(text, fallback = {}) {
  const candidate = toJsonCandidate(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        overview: normalizeText(parsed.overview) || normalizeText(fallback.overview),
        main_failure_reasons: safeArray(parsed.main_failure_reasons || fallback.main_failure_reasons),
        priority_actions: safeArray(parsed.priority_actions || fallback.priority_actions),
      };
    } catch {}
  }
  return {
    overview: normalizeText(text) || normalizeText(fallback.overview),
    main_failure_reasons: safeArray(fallback.main_failure_reasons),
    priority_actions: safeArray(fallback.priority_actions),
  };
}

function buildHistoryFallbackSummary(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const dayGroups = Array.isArray(payload && payload.day_groups) ? payload.day_groups : [];
  const runSummaries = Array.isArray(payload && payload.run_summaries) ? payload.run_summaries : [];
  const failures = items.filter((item) => String(item && item.status || "").toLowerCase() === "failed");
  return {
    overview: `History window contains ${items.length} events across ${dayGroups.length} day groups and ${runSummaries.length} run summaries.`,
    main_failure_reasons: safeArray(
      failures.slice(0, 3).map((item) => `${normalizeText(item.event_type) || "event"}: ${normalizeText(item.summary) || normalizeText(item.status) || "failed"}`)
    ),
    priority_actions: safeArray([
      failures.length > 0 ? "Inspect failed history events and compare them with the related run summaries." : "",
      dayGroups.length > 1 ? "Check whether failures cluster on specific days or providers." : "",
      runSummaries.length > 0 ? "Open the affected run summaries and confirm whether retry is still appropriate." : "",
    ]),
  };
}

function buildObservabilityFallbackSummary(payload) {
  const alerts = Array.isArray(payload && payload.anomalies && payload.anomalies.items ? payload.anomalies.items : [])
    ? payload.anomalies.items
    : [];
  const failureCodes = Array.isArray(payload && payload.failure_code_distribution && payload.failure_code_distribution.by_provider
    ? payload.failure_code_distribution.by_provider
    : [])
    ? payload.failure_code_distribution.by_provider
    : [];
  return {
    overview: `Observability window reports ${Number(payload && payload.run_counts ? payload.run_counts.total : 0) || 0} runs and ${alerts.length} active anomalies.`,
    main_failure_reasons: safeArray(
      alerts.slice(0, 3).map((item) => `${normalizeText(item.code) || "alert"}: ${normalizeText(item.summary) || normalizeText(item.title) || "anomaly detected"}`)
    ),
    priority_actions: safeArray([
      alerts.length > 0 ? "Review alerting anomalies before retrying the latest failed run." : "",
      failureCodes.length > 0 ? "Check the top failure code provider pair and confirm whether it is recurring." : "",
      "Compare the current metrics window with recent history before changing workflow assumptions.",
    ]),
  };
}

function buildHistoryEvidenceRefs(payload, filters = {}) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const dayGroups = Array.isArray(payload && payload.day_groups) ? payload.day_groups : [];
  const runSummaries = Array.isArray(payload && payload.run_summaries) ? payload.run_summaries : [];
  return {
    run_id: normalizeText(filters.run_id),
    thread_id: normalizeText(filters.thread_id),
    metric_snapshot: {
      event_count: items.length,
      day_group_count: dayGroups.length,
      run_summary_count: runSummaries.length,
      failed_event_count: items.filter((item) => String(item && item.status || "").toLowerCase() === "failed").length,
    },
    history_window: {
      project_id: normalizeText(filters.project_id),
      event_type: safeArray(filters.event_type || [], 5),
      provider: safeArray(filters.provider || [], 5),
      status: safeArray(filters.status || [], 5),
      start_at: normalizeText(filters.start_at),
      end_at: normalizeText(filters.end_at),
      recent_event_ids: items.slice(0, 5).map((item) => normalizeText(item && item.event_id)).filter(Boolean),
    },
    manual: [],
    runbook: [
      { title: "Phase5 Boundary", path: "docs/ai/core/workflow.md" },
      { title: "AI Evidence Model", path: "docs/ai/core/ai-evidence-model.md" },
    ],
    doc_source: [{ title: "Workspace History Model", path: "docs/ai/core/history-model.md" }],
  };
}

function buildObservabilityEvidenceRefs(payload, filters = {}) {
  const anomalies = Array.isArray(payload && payload.anomalies && payload.anomalies.items ? payload.anomalies.items : [])
    ? payload.anomalies.items
    : [];
  const failureCodes = Array.isArray(payload && payload.failure_code_distribution && payload.failure_code_distribution.by_provider
    ? payload.failure_code_distribution.by_provider
    : [])
    ? payload.failure_code_distribution.by_provider
    : [];
  const providerCounts = Array.isArray(payload && payload.operation_counts && payload.operation_counts.by_provider
    ? payload.operation_counts.by_provider
    : [])
    ? payload.operation_counts.by_provider
    : [];
  const scoreBands = Array.isArray(payload && payload.figma_fidelity_distribution && payload.figma_fidelity_distribution.score_bands
    ? payload.figma_fidelity_distribution.score_bands
    : [])
    ? payload.figma_fidelity_distribution.score_bands
    : [];
  return {
    run_id: "",
    thread_id: normalizeText(filters.thread_id),
    metric_snapshot: {
      total_runs: Number(payload && payload.run_counts ? payload.run_counts.total : 0) || 0,
      failed_runs: Number(payload && payload.run_counts && payload.run_counts.by_status ? payload.run_counts.by_status.failed : 0) || 0,
      anomaly_count: anomalies.length,
      provider_count: providerCounts.length,
      failure_code_count: failureCodes.length,
      runs_with_score: Number(payload && payload.figma_fidelity_distribution ? payload.figma_fidelity_distribution.runs_with_score : 0) || 0,
    },
    history_window: {
      project_id: normalizeText(filters.project_id),
      provider: safeArray(filters.provider || [], 5),
      start_at: normalizeText(filters.start_at),
      end_at: normalizeText(filters.end_at),
      anomaly_codes: anomalies.slice(0, 5).map((item) => normalizeText(item && item.code)).filter(Boolean),
      top_failure_codes: failureCodes.slice(0, 5).map((item) => normalizeText(item && item.failure_code)).filter(Boolean),
      score_bands: scoreBands.slice(0, 3).map((item) => `${normalizeText(item.band)}:${Number(item.count || 0)}`).filter(Boolean),
    },
    manual: [],
    runbook: [
      { title: "Phase5 Boundary", path: "docs/ai/core/workflow.md" },
      { title: "AI Evidence Model", path: "docs/ai/core/ai-evidence-model.md" },
    ],
    doc_source: [{ title: "Workspace Observability Model", path: "docs/ai/core/observability-model.md" }],
  };
}

function buildHistoryEvidenceSummary(payload) {
  return JSON.stringify({
    event_count: Array.isArray(payload && payload.items) ? payload.items.length : 0,
    run_summary_count: Array.isArray(payload && payload.run_summaries) ? payload.run_summaries.length : 0,
    top_items: (Array.isArray(payload && payload.items) ? payload.items : []).slice(0, 5).map((item) => ({
      event_type: normalizeText(item && item.event_type),
      provider: normalizeText(item && item.provider),
      status: normalizeText(item && item.status),
      summary: normalizeText(item && item.summary),
    })),
  });
}

function buildObservabilityEvidenceSummary(payload) {
  return JSON.stringify({
    run_counts: payload && payload.run_counts ? payload.run_counts : {},
    operation_counts: payload && payload.operation_counts ? payload.operation_counts : {},
    anomalies: payload && payload.anomalies ? payload.anomalies : {},
    failure_code_distribution: payload && payload.failure_code_distribution ? payload.failure_code_distribution : {},
    figma_fidelity_distribution: payload && payload.figma_fidelity_distribution ? payload.figma_fidelity_distribution : {},
  });
}

async function generateHistorySummary({ db = null, actorId = "", tenantId, apiKey, model, payload, filters = {} } = {}) {
  const evidenceRefs = buildHistoryEvidenceRefs(payload, filters);
  const fallbackSummary = buildHistoryFallbackSummary(payload);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "history_summary",
    prompt: 'Summarize the workspace history for an operator. Return JSON only. Schema: {"overview":"string","main_failure_reasons":["string"],"priority_actions":["string"]}',
    evidence_summary: buildHistoryEvidenceSummary(payload),
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
    run_id: "",
    thread_id: normalizeText(filters.thread_id),
    summary: result.status === "ok" ? parseSummaryBody(result.response, fallbackSummary) : fallbackSummary,
    evidence_refs: result.evidence_refs || evidenceRefs,
  };
}

async function generateObservabilitySummary({ db = null, actorId = "", tenantId, apiKey, model, payload, filters = {} } = {}) {
  const evidenceRefs = buildObservabilityEvidenceRefs(payload, filters);
  const fallbackSummary = buildObservabilityFallbackSummary(payload);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "observability_summary",
    prompt: 'Summarize the workspace observability metrics for an operator. Return JSON only. Schema: {"overview":"string","main_failure_reasons":["string"],"priority_actions":["string"]}',
    evidence_summary: buildObservabilityEvidenceSummary(payload),
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
    run_id: "",
    thread_id: normalizeText(filters.thread_id),
    summary: result.status === "ok" ? parseSummaryBody(result.response, fallbackSummary) : fallbackSummary,
    evidence_refs: result.evidence_refs || evidenceRefs,
  };
}

module.exports = {
  generateHistorySummary,
  generateObservabilitySummary,
};
