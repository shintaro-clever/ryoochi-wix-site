"use strict";

const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { summarizeEvidenceRefs } = require("../ai/aiEvidenceModel");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function summarizeText(value, max = 200) {
  const text = normalizeText(value);
  if (!text) {
    return { present: false, length: 0, preview: "" };
  }
  return {
    present: true,
    length: text.length,
    preview: text.slice(0, max),
  };
}

function normalizeUsage(usage) {
  const source = usage && typeof usage === "object" ? usage : {};
  return {
    input_tokens: normalizeCount(source.input_tokens),
    output_tokens: normalizeCount(source.output_tokens),
    total_tokens: normalizeCount(source.total_tokens),
  };
}

function recordAiLifecycleEvent({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  action,
  useCase = "",
  model = "",
  projectId = "",
  threadId = "",
  runId = "",
  prompt = "",
  evidenceSummary = "",
  evidenceRefs = null,
  response = "",
  status = "",
  failureCode = "",
  latencyMs = 0,
  tokenUsage = null,
} = {}) {
  recordAudit({
    db,
    action,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      provider: "openai",
      use_case: normalizeText(useCase),
      model: normalizeText(model),
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      run_id: normalizeText(runId) || null,
      status: normalizeText(status) || null,
      failure_code: normalizeText(failureCode) || null,
      latency_ms: normalizeCount(latencyMs),
      prompt_summary: summarizeText(prompt),
      evidence_summary: summarizeText(evidenceSummary),
      evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
      response_summary: summarizeText(response),
      token_usage: normalizeUsage(tokenUsage),
    },
  });
}

function recordSummaryGenerated({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  summaryType = "",
  projectId = "",
  threadId = "",
  runId = "",
  summary = "",
  evidenceRefs = null,
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.SUMMARY_GENERATED,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      summary_type: normalizeText(summaryType),
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      run_id: normalizeText(runId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
      summary_preview: summarizeText(summary),
      evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
    },
  });
}

function recordAnalysisGenerated({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  analysisType = "",
  alertCode = "",
  projectId = "",
  threadId = "",
  analysis = "",
  evidenceRefs = null,
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.ANALYSIS_GENERATED,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      analysis_type: normalizeText(analysisType),
      alert_code: normalizeText(alertCode) || null,
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
      analysis_preview: summarizeText(analysis),
      evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
    },
  });
}

function recordTranslationGenerated({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  sourceUseCase = "",
  targetLanguage = "",
  projectId = "",
  threadId = "",
  runId = "",
  translated = "",
  evidenceRefs = null,
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.TRANSLATION_GENERATED,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      source_use_case: normalizeText(sourceUseCase),
      target_language: normalizeText(targetLanguage),
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      run_id: normalizeText(runId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
      translated_preview: summarizeText(translated),
      evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
    },
  });
}

function recordAiSummaryRequest({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  summaryType = "",
  projectId = "",
  threadId = "",
  runId = "",
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.AI_SUMMARY_REQUEST,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      summary_type: normalizeText(summaryType),
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      run_id: normalizeText(runId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
    },
  });
}

function recordAiAnalysisRequest({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  analysisType = "",
  alertCode = "",
  projectId = "",
  threadId = "",
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.AI_ANALYSIS_REQUEST,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      analysis_type: normalizeText(analysisType),
      alert_code: normalizeText(alertCode) || null,
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
    },
  });
}

function recordAiTranslationRequest({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  sourceUseCase = "",
  targetLanguage = "",
  projectId = "",
  threadId = "",
  runId = "",
  status = "",
  failureCode = "",
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.AI_TRANSLATION_REQUEST,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      source_use_case: normalizeText(sourceUseCase),
      target_language: normalizeText(targetLanguage),
      project_id: normalizeText(projectId) || null,
      thread_id: normalizeText(threadId) || null,
      run_id: normalizeText(runId) || null,
      status: normalizeText(status) || "unknown",
      failure_code: normalizeText(failureCode) || null,
    },
  });
}

function recordFaqQuery({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  audience = "",
  language = "",
  status = "",
  confidence = "",
  escalationHint = "",
  guardrailCode = "",
  failureCode = "",
  tokenUsage = null,
} = {}) {
  const usage = tokenUsage && typeof tokenUsage === "object" ? tokenUsage : {};
  recordAudit({
    db,
    action: AUDIT_ACTIONS.FAQ_QUERY,
    tenantId,
    actorId: normalizeText(actorId) || null,
    meta: {
      audience: normalizeText(audience) || "general",
      language: normalizeText(language) || "ja",
      status: normalizeText(status) || "unknown",
      confidence: normalizeText(confidence) || "low",
      escalation: Boolean(normalizeText(escalationHint)),
      resolved: !normalizeText(escalationHint) && ["high", "medium"].includes(normalizeText(confidence)),
      guardrail_triggered: Boolean(normalizeText(guardrailCode)),
      guardrail_code: normalizeText(guardrailCode) || null,
      failure_code: normalizeText(failureCode) || null,
      token_usage: {
        input_tokens: normalizeCount(usage.input_tokens),
        output_tokens: normalizeCount(usage.output_tokens),
        total_tokens: normalizeCount(usage.total_tokens),
      },
    },
  });
}

function recordFaqLifecycle({
  db = null,
  actorId = "",
  tenantId = DEFAULT_TENANT,
  question = "",
  answer = "",
  audience = "",
  language = "",
  confidence = "",
  escalationHint = "",
  guardrailCode = "",
  evidenceRefs = null,
} = {}) {
  const actor = normalizeText(actorId) || null;
  const commonMeta = {
    audience: normalizeText(audience) || "general",
    language: normalizeText(language) || "ja",
    confidence: normalizeText(confidence) || "low",
    question_summary: summarizeText(question),
    answer_summary: summarizeText(answer),
    escalation_hint_summary: summarizeText(escalationHint),
    guardrail_code: normalizeText(guardrailCode) || null,
    evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
  };
  recordAudit({
    db,
    action: AUDIT_ACTIONS.FAQ_QUERIED,
    tenantId,
    actorId: actor,
    meta: {
      ...commonMeta,
      event: "queried",
    },
  });
  recordAudit({
    db,
    action: AUDIT_ACTIONS.FAQ_ANSWERED,
    tenantId,
    actorId: actor,
    meta: {
      ...commonMeta,
      event: "answered",
    },
  });
  if (normalizeText(escalationHint)) {
    recordAudit({
      db,
      action: AUDIT_ACTIONS.FAQ_ESCALATED,
      tenantId,
      actorId: actor,
      meta: {
        ...commonMeta,
        event: "escalated",
      },
    });
  }
  if (normalizeText(guardrailCode)) {
    recordAudit({
      db,
      action: AUDIT_ACTIONS.FAQ_GUARDRAIL_APPLIED,
      tenantId,
      actorId: actor,
      meta: {
        ...commonMeta,
        event: "guardrail_applied",
      },
    });
  }
}

module.exports = {
  recordAiLifecycleEvent,
  recordAiSummaryRequest,
  recordAiAnalysisRequest,
  recordAiTranslationRequest,
  recordSummaryGenerated,
  recordAnalysisGenerated,
  recordTranslationGenerated,
  recordFaqQuery,
  recordFaqLifecycle,
};
