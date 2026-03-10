const { executeOpenAiTextUseCase } = require("./openaiClient");
const { buildEvidenceRefs } = require("./aiEvidenceModel");
const { translateAssistPayload } = require("./aiTranslate");
const { applyFaqGuardrails } = require("./faqGuardrails");
const { searchFaqKnowledgeSources } = require("../db/faqKnowledgeSources");

const SUPPORTED_FAQ_AUDIENCES = Object.freeze(["general", "operator"]);
const SUPPORTED_FAQ_LANGUAGES = Object.freeze(["ja", "en"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value, max = 5) {
  return (Array.isArray(value) ? value : []).map((entry) => normalizeText(entry)).filter(Boolean).slice(0, max);
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

function buildFaqEvidenceRefs(question, audience, sources) {
  const refs = {
    run_id: "",
    thread_id: "",
    metric_snapshot: {
      source_count: Array.isArray(sources) ? sources.length : 0,
      audience,
    },
    history_window: {
      question,
      audience,
    },
    manual: [],
    runbook: [],
    doc_source: [],
  };
  (Array.isArray(sources) ? sources : []).forEach((item) => {
    const ref = {
      title: item.title,
      path: item.path,
      section: item.section,
      source_type: item.source_type,
      ref_kind: item.ref_kind,
      audience: item.audience,
    };
    if (item.source_type === "manual") refs.manual.push(ref);
    else if (item.source_type === "runbook") refs.runbook.push(ref);
    else refs.doc_source.push(ref);
  });
  return buildEvidenceRefs(refs);
}

function buildFaqEvidenceSummary(question, audience, sources) {
  return JSON.stringify({
    question: normalizeText(question),
    audience: normalizeText(audience),
    sources: (Array.isArray(sources) ? sources : []).slice(0, 4).map((item) => ({
      source_type: item.source_type,
      title: item.title,
      path: item.path,
      section: item.section,
      excerpt: normalizeText(item.excerpt).slice(0, 240),
    })),
  });
}

function buildFaqPrompt(question, audience) {
  return [
    `Answer the FAQ for a ${audience} audience.`,
    "Use only the supplied evidence summary and do not invent sources.",
    "If the sources are insufficient or ambiguous, return a cautious answer and include an escalation_hint.",
    'Return JSON only with schema: {"answer":"string","confidence":"high|medium|low","escalation_hint":"string"}',
    `Question: ${normalizeText(question)}`,
  ].join("\n\n");
}

function buildEscalationPayload({ question, audience, reason, sources = [] } = {}) {
  const normalizedReason = normalizeText(reason) || "source_of_truth is insufficient";
  const primaryRef = sources[0];
  const pathHint = primaryRef && primaryRef.path ? `関連候補: ${primaryRef.path}` : "関連する SoT / runbook / manual を確認してください。";
  return {
    answer: audience === "operator"
      ? `正本だけでは断定できません。質問内容を運用者向け手順と照合して追加確認してください。`
      : `正本だけでは確実に案内できません。関連ドキュメントを確認してください。`,
    confidence: "low",
    escalation_hint: `${normalizedReason}. ${pathHint}`,
    reason_code: normalizedReason.includes("ambiguous") ? "ambiguous" : "insufficient_sources",
  };
}

function classifySourceConfidence(sources) {
  const top = sources[0];
  const second = sources[1];
  if (!top || Number(top.score || 0) < 4) {
    return { level: "low", reason: "insufficient_sources" };
  }
  if (second && Number(top.score || 0) - Number(second.score || 0) <= 1 && Number(top.score || 0) < 10) {
    return { level: "low", reason: "ambiguous_sources" };
  }
  if (Number(top.score || 0) < 9) {
    return { level: "medium", reason: "" };
  }
  return { level: "high", reason: "" };
}

function shouldForceEscalation(question) {
  return /(未定義|存在しない|不明|unknown|undefined|not exist|does not exist)/i.test(normalizeText(question));
}

function parseFaqBody(text, fallback) {
  const candidate = toJsonCandidate(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        answer: normalizeText(parsed.answer) || fallback.answer,
        confidence: ["high", "medium", "low"].includes(normalizeText(parsed.confidence).toLowerCase())
          ? normalizeText(parsed.confidence).toLowerCase()
          : fallback.confidence,
        escalation_hint: normalizeText(parsed.escalation_hint) || fallback.escalation_hint,
      };
    } catch {}
  }
  return fallback;
}

async function translateFaqPayload({ db, actorId, tenantId, apiKey, model, language, payload, evidence_refs }) {
  if (language === "ja") return payload;
  const translated = await translateAssistPayload({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    source_use_case: "faq",
    target_language: language,
    payload: {
      faq: {
        answer: payload.answer,
        escalation_hint: payload.escalation_hint,
        follow_up_actions: [],
      },
    },
    evidence_refs,
  });
  const faq = translated && translated.translated && translated.translated.faq ? translated.translated.faq : {};
  return {
    answer: normalizeText(faq.answer) || payload.answer,
    confidence: payload.confidence,
    escalation_hint: normalizeText(faq.escalation_hint) || payload.escalation_hint,
    translation_status: translated.status,
    translation_error: translated.error,
    translation_failure_code: translated.failure_code,
  };
}

async function generateFaqAnswer({
  db = null,
  actorId = "",
  tenantId,
  apiKey,
  model,
  question,
  audience = "general",
  language = "ja",
} = {}) {
  const normalizedQuestion = normalizeText(question);
  const normalizedAudience = SUPPORTED_FAQ_AUDIENCES.includes(normalizeText(audience).toLowerCase())
    ? normalizeText(audience).toLowerCase()
    : "general";
  const normalizedLanguage = SUPPORTED_FAQ_LANGUAGES.includes(normalizeText(language).toLowerCase())
    ? normalizeText(language).toLowerCase()
    : "ja";
  const sources = searchFaqKnowledgeSources({
    db,
    tenantId,
    question: normalizedQuestion,
    audience: normalizedAudience,
    limit: normalizedAudience === "operator" ? 4 : 3,
  });
  const evidenceRefs = buildFaqEvidenceRefs(normalizedQuestion, normalizedAudience, sources);
  const confidenceGate = shouldForceEscalation(normalizedQuestion)
    ? { level: "low", reason: "insufficient_sources" }
    : classifySourceConfidence(sources);

  if (!sources.length || confidenceGate.level === "low") {
    const fallback = buildEscalationPayload({
      question: normalizedQuestion,
      audience: normalizedAudience,
      reason: confidenceGate.reason || "insufficient_sources",
      sources,
    });
    const guardedFallback = applyFaqGuardrails({
      question: normalizedQuestion,
      answer: fallback.answer,
      confidence: fallback.confidence,
      escalation_hint: fallback.escalation_hint,
    });
    const translatedFallback = await translateFaqPayload({
      db,
      actorId,
      tenantId,
      apiKey,
      model,
      language: normalizedLanguage,
      payload: guardedFallback,
      evidence_refs: evidenceRefs,
    });
    return {
      provider: "openai",
      model: normalizeText(model),
      use_case: "faq",
      status: "ok",
      error: null,
      failure_code: null,
      latency_ms: 0,
      token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      question: normalizedQuestion,
      audience: normalizedAudience,
      language: normalizedLanguage,
      answer: translatedFallback.answer,
      confidence: translatedFallback.confidence || guardedFallback.confidence,
      evidence_refs: evidenceRefs,
      escalation_hint: translatedFallback.escalation_hint || guardedFallback.escalation_hint,
      guardrail_code: guardedFallback.guardrail_code || "",
    };
  }

  const fallback = {
    answer: normalizedAudience === "operator"
      ? `候補文書を確認すると、${sources[0].title} を起点に確認するのが妥当です。`
      : `候補文書を確認すると、${sources[0].title} を起点に確認するのが妥当です。`,
    confidence: confidenceGate.level,
    escalation_hint: confidenceGate.level === "medium" ? "曖昧さが残る場合は関連 runbook / manual を追加確認してください。" : "",
  };

  const result = await executeOpenAiTextUseCase({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    use_case: "faq",
    prompt: buildFaqPrompt(normalizedQuestion, normalizedAudience),
    evidence_summary: buildFaqEvidenceSummary(normalizedQuestion, normalizedAudience, sources),
    evidence_refs: evidenceRefs,
  });

  const parsed = result.status === "ok" ? parseFaqBody(result.response, fallback) : fallback;
  const guarded = applyFaqGuardrails({
    question: normalizedQuestion,
    answer: parsed.answer,
    confidence: parsed.confidence,
    escalation_hint: parsed.escalation_hint,
  });
  const translated = await translateFaqPayload({
    db,
    actorId,
    tenantId,
    apiKey,
    model,
    language: normalizedLanguage,
    payload: guarded,
    evidence_refs: result.evidence_refs || evidenceRefs,
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
    question: normalizedQuestion,
    audience: normalizedAudience,
    language: normalizedLanguage,
    answer: translated.answer,
    confidence: translated.confidence || guarded.confidence,
    evidence_refs: result.evidence_refs || evidenceRefs,
    escalation_hint: translated.escalation_hint || guarded.escalation_hint,
    guardrail_code: guarded.guardrail_code || "",
  };
}

module.exports = {
  SUPPORTED_FAQ_AUDIENCES,
  SUPPORTED_FAQ_LANGUAGES,
  generateFaqAnswer,
};
