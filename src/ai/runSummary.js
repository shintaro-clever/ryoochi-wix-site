const { executeOpenAiTextUseCase } = require("./openaiClient");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value, max = 3) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, max);
}

function toJsonCandidate(text) {
  const source = normalizeText(text);
  if (!source) return "";
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return source.slice(start, end + 1);
  }
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
    } catch {
      // fall through to fallback
    }
  }
  return {
    overview: normalizeText(text) || normalizeText(fallback.overview),
    main_failure_reasons: safeArray(fallback.main_failure_reasons),
    priority_actions: safeArray(fallback.priority_actions),
  };
}

function buildFallbackSummary(run, evidenceRefs = {}) {
  const externalOperations = Array.isArray(run && run.external_operations) ? run.external_operations : [];
  const failingOps = externalOperations.filter((entry) => entry && entry.result && entry.result.status === "error");
  const failureReasons = [];
  if (normalizeText(run && run.failure_code)) {
    failureReasons.push(`run failure_code=${normalizeText(run.failure_code)}`);
  }
  failingOps.slice(0, 2).forEach((entry) => {
    const provider = normalizeText(entry.provider) || "external";
    const reason = normalizeText(entry.result && (entry.result.reason || entry.result.failure_code)) || "unknown";
    failureReasons.push(`${provider}: ${reason}`);
  });
  const actions = [];
  if (run && run.status === "failed") {
    actions.push("Inspect the failing run and retry only after confirming the external target and input scope.");
  }
  if (evidenceRefs && evidenceRefs.metric_snapshot && evidenceRefs.metric_snapshot.project_failed_runs > 0) {
    actions.push("Check recent failed runs in the same project to determine whether this is isolated or recurring.");
  }
  if (run && run.figma_before_after && run.figma_before_after.structure_diff_summary) {
    actions.push("Review the Figma structure/visual diff before the next write attempt.");
  }
  return {
    overview:
      `Run ${normalizeText(run && run.run_id) || "-"} is ${normalizeText(run && run.status) || "unknown"} ` +
      `for ${normalizeText(run && run.job_type) || "run"}.`,
    main_failure_reasons: safeArray(failureReasons),
    priority_actions: safeArray(actions),
  };
}

function buildRunSummaryPrompt(run) {
  return [
    "Summarize the run for an operator.",
    "Return JSON only.",
    'Schema: {"overview":"string","main_failure_reasons":["string"],"priority_actions":["string"]}',
    "Keep overview to 1-2 sentences.",
    "List at most 3 failure reasons and 3 priority actions.",
    "Base the answer only on the provided evidence.",
    `Current run status: ${normalizeText(run && run.status) || "-"}.`,
  ].join("\n");
}

function buildRunEvidenceSummary(run, projectRuns = []) {
  const externalOperations = Array.isArray(run && run.external_operations) ? run.external_operations : [];
  const figmaBeforeAfter = run && run.figma_before_after && typeof run.figma_before_after === "object"
    ? run.figma_before_after
    : null;
  const structureDiff = figmaBeforeAfter && figmaBeforeAfter.structure_diff_summary
    ? JSON.stringify(figmaBeforeAfter.structure_diff_summary)
    : "-";
  const visualDiff = figmaBeforeAfter && figmaBeforeAfter.visual_diff_summary
    ? JSON.stringify(figmaBeforeAfter.visual_diff_summary)
    : "-";
  return [
    `run_id=${normalizeText(run && run.run_id) || "-"}`,
    `thread_id=${normalizeText(run && run.thread_id) || "-"}`,
    `job_type=${normalizeText(run && run.job_type) || "-"}`,
    `status=${normalizeText(run && run.status) || "-"}`,
    `failure_code=${normalizeText(run && run.failure_code) || "-"}`,
    `external_operations=${externalOperations.length}`,
    `project_recent_runs=${projectRuns.length}`,
    `structure_diff=${structureDiff}`,
    `visual_diff=${visualDiff}`,
  ].join("\n");
}

function buildRunEvidenceRefs(run, projectRuns = []) {
  const rows = Array.isArray(projectRuns) ? projectRuns : [];
  const sameThread = rows.filter((entry) => entry && entry.thread_id && entry.thread_id === run.thread_id).slice(0, 5);
  const failedRuns = rows.filter((entry) => entry && entry.status === "failed");
  const externalOperations = Array.isArray(run && run.external_operations) ? run.external_operations : [];
  const githubOps = externalOperations.filter((entry) => entry && entry.provider === "github");
  const figmaOps = externalOperations.filter((entry) => entry && entry.provider === "figma");
  const figmaCompare = run && run.figma_before_after && typeof run.figma_before_after === "object" ? run.figma_before_after : {};
  const structure = figmaCompare.structure_diff_summary && typeof figmaCompare.structure_diff_summary === "object"
    ? figmaCompare.structure_diff_summary
    : null;
  const visual = figmaCompare.visual_diff_summary && typeof figmaCompare.visual_diff_summary === "object"
    ? figmaCompare.visual_diff_summary
    : null;
  return {
    run_id: run && run.run_id ? run.run_id : "",
    thread_id: run && run.thread_id ? run.thread_id : "",
    metric_snapshot: {
      project_recent_runs: rows.length,
      project_failed_runs: failedRuns.length,
      same_thread_recent_runs: sameThread.length,
      github_operation_count: githubOps.length,
      figma_operation_count: figmaOps.length,
      structure_major_diff: Boolean(structure && structure.major_diff_detected),
      visual_score: visual && typeof visual.score === "number" ? Number(visual.score) : null,
    },
    history_window: {
      recent_project_run_ids: rows.slice(0, 5).map((entry) => entry.run_id).filter(Boolean),
      recent_project_statuses: rows.slice(0, 5).map((entry) => entry.status).filter(Boolean),
      same_thread_run_ids: sameThread.map((entry) => entry.run_id).filter(Boolean),
    },
    manual: [],
    runbook: [
      { title: "Phase5 Boundary", path: "docs/ai/core/workflow.md" },
      { title: "OpenAI Data Boundary", path: "docs/ai/core/openai-data-boundary.md" },
    ],
    doc_source: [
      { title: "AI Evidence Model", path: "docs/ai/core/ai-evidence-model.md" },
      { title: "OpenAI Assist Model", path: "docs/ai/core/openai-assist-model.md" },
    ],
  };
}

async function generateRunSummary({
  db = null,
  actorId = "",
  tenantId,
  apiKey,
  model,
  run,
  projectRuns = [],
} = {}) {
  const evidenceRefs = buildRunEvidenceRefs(run, projectRuns);
  const fallbackSummary = buildFallbackSummary(run, evidenceRefs);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "run_summary",
    prompt: buildRunSummaryPrompt(run),
    evidence_summary: buildRunEvidenceSummary(run, projectRuns),
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
    run_id: run && run.run_id ? run.run_id : "",
    thread_id: run && run.thread_id ? run.thread_id : "",
    summary:
      result.status === "ok"
        ? parseSummaryBody(result.response, fallbackSummary)
        : { ...fallbackSummary, main_failure_reasons: [], priority_actions: [] },
    evidence_refs: result.evidence_refs || evidenceRefs,
  };
}

module.exports = {
  generateRunSummary,
  buildRunEvidenceRefs,
  parseSummaryBody,
};
