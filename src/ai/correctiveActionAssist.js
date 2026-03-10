const { executeOpenAiTextUseCase } = require("./openaiClient");

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

function normalizeConfidence(value, fallback = "medium") {
  const text = normalizeText(value).toLowerCase();
  if (text === "high" || text === "medium" || text === "low") return text;
  return fallback;
}

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function parseAssistBody(text, fallback = {}) {
  const candidate = toJsonCandidate(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        target_file_or_component: safeArray(parsed.target_file_or_component || fallback.target_file_or_component, 5),
        expected_impact: safeArray(parsed.expected_impact || fallback.expected_impact, 4),
        confidence: normalizeConfidence(parsed.confidence, fallback.confidence),
        confirm_required: parseBoolean(parsed.confirm_required, fallback.confirm_required),
        linked_reason_types: safeArray(parsed.linked_reason_types || fallback.linked_reason_types, 6),
      };
    } catch {}
  }
  return {
    target_file_or_component: safeArray(fallback.target_file_or_component, 5),
    expected_impact: safeArray(fallback.expected_impact, 4),
    confidence: normalizeConfidence(fallback.confidence),
    confirm_required: parseBoolean(fallback.confirm_required, true),
    linked_reason_types: safeArray(fallback.linked_reason_types, 6),
  };
}

function fallbackTargetForCategory(action = {}) {
  const category = normalizeText(action.category);
  if (category === "component_swap") return ["component mapping", "variant reference", "approved design binding"];
  if (category === "layout_fix") return ["layout constraints", "responsive breakpoint rules", "container sizing"];
  if (category === "token_fix") return ["design tokens", "theme variables", "style mapping"];
  if (category === "state_addition") return ["UI state handling", "state transitions", "test coverage"];
  if (category === "environment_alignment") return ["runtime environment settings", "browser/font configuration", "validation environment"];
  if (category === "code_update") return ["implementation branch", "runtime logic", "integration contract"];
  if (category === "design_review") return ["approved Figma source", "design SoT", "review checklist"];
  return ["affected component", "related implementation path", "validation coverage"];
}

function buildFallbackAssist(action = {}, plan = {}, run = null) {
  const category = normalizeText(action.category) || "investigation";
  const reasonTypes = safeArray(action.reason_types || [], 6);
  const suggestedTargets = safeArray(action.suggested_target_paths || [], 5);
  const targets = suggestedTargets.length ? suggestedTargets : fallbackTargetForCategory(action);
  return {
    target_file_or_component: targets,
    expected_impact: safeArray([
      `${category} remediation should reduce recurrence across ${Number(action.reason_count || 0)} linked reasons.`,
      run ? "The related run can be revalidated after the change without expanding automation scope." : "",
      plan && plan.summary ? `This action comes from a grouped corrective plan with ${Number(plan.summary.total_actions || 0)} actions.` : "",
    ], 4),
    confidence: category === "investigation" || category === "design_review" ? "low" : "medium",
    confirm_required: true,
    linked_reason_types: reasonTypes,
  };
}

function buildEvidenceRefs({ run, plan, action }) {
  return {
    run_id: normalizeText(run && run.run_id),
    thread_id: normalizeText(run && run.thread_id),
    metric_snapshot: {
      plan_total_actions: Number(plan && plan.summary ? plan.summary.total_actions : 0) || 0,
      plan_total_reasons: Number(plan && plan.summary ? plan.summary.total_reasons : 0) || 0,
      action_reason_count: Number(action && action.reason_count) || 0,
      action_priority: Number(action && action.priority) || 0,
    },
    history_window: {
      action_key: normalizeText(action && action.key),
      action_category: normalizeText(action && action.category),
      eligible_providers: safeArray(action && action.eligible_providers, 4),
      suggested_target_paths: safeArray(action && action.suggested_target_paths, 5),
      linked_reason_types: safeArray(action && action.reason_types, 6),
      linked_reason_codes: safeArray(action && action.reason_codes, 6),
    },
    manual: [],
    runbook: [
      { title: "Phase5 Boundary", path: "docs/ai/core/workflow.md" },
      { title: "AI Evidence Model", path: "docs/ai/core/ai-evidence-model.md" },
      { title: "Fidelity Reason Taxonomy", path: "docs/ai/core/fidelity-reasons.md" },
    ],
    doc_source: [
      { title: "Corrective Action Plan", path: "src/fidelity/correctiveActionPlan.js" },
      { title: "Corrective Action Connect", path: "src/fidelity/correctiveActionConnect.js" },
    ],
  };
}

function buildEvidenceSummary({ run, plan, action }) {
  return JSON.stringify({
    run_id: normalizeText(run && run.run_id),
    thread_id: normalizeText(run && run.thread_id),
    action: {
      key: normalizeText(action && action.key),
      category: normalizeText(action && action.category),
      title: normalizeText(action && action.title),
      rationale: normalizeText(action && action.rationale),
      recommendation: normalizeText(action && action.recommendation),
      reason_types: safeArray(action && action.reason_types, 6),
      reason_codes: safeArray(action && action.reason_codes, 6),
      suggested_target_paths: safeArray(action && action.suggested_target_paths, 5),
      eligible_providers: safeArray(action && action.eligible_providers, 4),
    },
    corrective_action_plan_summary: plan && plan.summary ? plan.summary : {},
  });
}

async function generateCorrectiveActionAssist({ db = null, actorId = "", tenantId, apiKey, model, run = null, plan, action } = {}) {
  const evidenceRefs = buildEvidenceRefs({ run, plan, action });
  const fallbackAssist = buildFallbackAssist(action, plan, run);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "corrective_action_assist",
    prompt:
      'Expand the selected corrective action into a concrete but non-autonomous operator assist. Return JSON only. Schema: {"target_file_or_component":["string"],"expected_impact":["string"],"confidence":"high|medium|low","confirm_required":true,"linked_reason_types":["string"]}',
    evidence_summary: buildEvidenceSummary({ run, plan, action }),
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
    action_key: normalizeText(action && action.key),
    action_type: normalizeText(action && action.category),
    title: normalizeText(action && action.title),
    target_file_or_component: [],
    expected_impact: [],
    confidence: "medium",
    confirm_required: true,
    linked_reason_types: [],
    evidence_refs: result.evidence_refs || evidenceRefs,
    ...parseAssistBody(result.response, fallbackAssist),
  };
}

module.exports = {
  generateCorrectiveActionAssist,
};
