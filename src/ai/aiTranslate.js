const fs = require("fs");
const path = require("path");
const { executeOpenAiTextUseCase } = require("./openaiClient");
const { buildEvidenceRefs } = require("./aiEvidenceModel");

const SUPPORTED_TRANSLATE_USE_CASES = Object.freeze([
  "run_summary",
  "history_summary",
  "observability_summary",
  "observability_analysis",
  "faq",
]);

const SUPPORTED_TARGET_LANGUAGES = Object.freeze(["ja", "en"]);

const GLOSSARY_PATH = path.join(__dirname, "..", "..", "docs", "i18n", "glossary.md");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadGlossaryExcerpt() {
  try {
    const text = fs.readFileSync(GLOSSARY_PATH, "utf8");
    return text.split("\n").slice(0, 120).join("\n");
  } catch {
    return "";
  }
}

function sanitizeFaqContent(source = {}) {
  return {
    answer: normalizeText(source.answer),
    escalation_hint: normalizeText(source.escalation_hint),
    follow_up_actions: Array.isArray(source.follow_up_actions)
      ? source.follow_up_actions.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 5)
      : [],
  };
}

function normalizeTranslatablePayload(useCase, payload = {}) {
  const source = asObject(payload);
  if (useCase === "run_summary" || useCase === "history_summary" || useCase === "observability_summary") {
    return {
      summary: {
        overview: normalizeText(source.summary && source.summary.overview),
        main_failure_reasons: Array.isArray(source.summary && source.summary.main_failure_reasons)
          ? source.summary.main_failure_reasons.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
          : [],
        priority_actions: Array.isArray(source.summary && source.summary.priority_actions)
          ? source.summary.priority_actions.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
          : [],
      },
    };
  }
  if (useCase === "observability_analysis") {
    return {
      analysis: {
        candidate_causes: Array.isArray(source.analysis && source.analysis.candidate_causes)
          ? source.analysis.candidate_causes.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
          : [],
        impact_scope: Array.isArray(source.analysis && source.analysis.impact_scope)
          ? source.analysis.impact_scope.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
          : [],
        additional_checks: Array.isArray(source.analysis && source.analysis.additional_checks)
          ? source.analysis.additional_checks.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
          : [],
      },
    };
  }
  return {
    faq: sanitizeFaqContent(source.faq || source),
  };
}

function buildTranslateEvidenceSummary(useCase, targetLanguage, payload) {
  return JSON.stringify({
    source_use_case: useCase,
    target_language: targetLanguage,
    payload,
  });
}

function buildTranslatePrompt(useCase, targetLanguage, payload) {
  const glossary = loadGlossaryExcerpt();
  return [
    `Translate the provided ${useCase} payload into ${targetLanguage}.`,
    "Return JSON only.",
    "Preserve the exact same JSON keys and array structure.",
    "Do not rename or translate managed glossary terms such as status, failure_code, action_type, reason_type, confirm_required, project, thread, run, evidence_refs.",
    "Translate only human-readable values.",
    "If a managed term appears in a sentence, keep the managed term literal and translate surrounding prose only.",
    glossary ? `Glossary excerpt:\n${glossary}` : "",
    `Payload:\n${JSON.stringify(payload)}`,
  ].filter(Boolean).join("\n\n");
}

function mergeTranslatedPayload(useCase, fallbackPayload, responseText) {
  const fallback = cloneJsonSafe(fallbackPayload);
  const source = normalizeText(responseText);
  if (!source) return fallback;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced && fenced[1] ? fenced[1].trim() : source;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") return fallback;
    if (useCase === "run_summary" || useCase === "history_summary" || useCase === "observability_summary") {
      const translated = normalizeTranslatablePayload(useCase, parsed);
      return translated.summary && translated.summary.overview ? translated : fallback;
    }
    if (useCase === "observability_analysis") {
      const translated = normalizeTranslatablePayload(useCase, parsed);
      return Array.isArray(translated.analysis.candidate_causes) ? translated : fallback;
    }
    const translated = normalizeTranslatablePayload(useCase, parsed);
    return translated.faq && translated.faq.answer ? translated : fallback;
  } catch {
    return fallback;
  }
}

async function translateAssistPayload({
  db = null,
  actorId = "",
  tenantId,
  apiKey,
  model,
  source_use_case,
  target_language,
  payload,
  evidence_refs = {},
} = {}) {
  const normalizedUseCase = normalizeText(source_use_case).toLowerCase();
  const normalizedTargetLanguage = normalizeText(target_language).toLowerCase();
  const normalizedPayload = normalizeTranslatablePayload(normalizedUseCase, payload);
  const normalizedEvidenceRefs = buildEvidenceRefs(evidence_refs);
  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "translation",
    prompt: buildTranslatePrompt(normalizedUseCase, normalizedTargetLanguage, normalizedPayload),
    evidence_summary: buildTranslateEvidenceSummary(normalizedUseCase, normalizedTargetLanguage, normalizedPayload),
    evidence_refs: normalizedEvidenceRefs,
  });
  return {
    provider: result.provider,
    model: result.model,
    use_case: result.use_case,
    source_use_case: normalizedUseCase,
    target_language: normalizedTargetLanguage,
    status: result.status,
    error: result.error,
    failure_code: result.failure_code,
    latency_ms: result.latency_ms,
    token_usage: result.token_usage,
    translated: result.status === "ok"
      ? mergeTranslatedPayload(normalizedUseCase, normalizedPayload, result.response)
      : normalizedPayload,
    evidence_refs: result.evidence_refs || normalizedEvidenceRefs,
  };
}

module.exports = {
  SUPPORTED_TRANSLATE_USE_CASES,
  SUPPORTED_TARGET_LANGUAGES,
  translateAssistPayload,
};
