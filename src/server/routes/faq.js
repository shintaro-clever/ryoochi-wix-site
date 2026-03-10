const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { getPersonalAiSetting, getDefaultPersonalAiSetting } = require("../personalAiSettingsStore");
const { resolveSecretReference } = require("../openaiConnection");
const {
  SUPPORTED_FAQ_AUDIENCES,
  SUPPORTED_FAQ_LANGUAGES,
  generateFaqAnswer,
} = require("../../ai/faqAnswer");
const { recordFaqQuery, recordFaqLifecycle } = require("../aiMetricsAudit");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveOpenAiFaqContext(db, userId, explicitAiSettingId = "") {
  const aiSetting = explicitAiSettingId
    ? getPersonalAiSetting(db, userId, explicitAiSettingId)
    : getDefaultPersonalAiSetting(db, userId);
  if (!aiSetting) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "default ai setting is not configured", details: { failure_code: "validation_error" } };
  }
  if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
    throw { status: 400, code: "VALIDATION_ERROR", message: "provider is not supported for faq", details: { failure_code: "validation_error" } };
  }
  const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
    fallbackEnvName: "OPENAI_API_KEY",
  });
  if (!resolved.ok) {
    throw { status: 400, code: "VALIDATION_ERROR", message: resolved.error, details: { failure_code: "validation_error" } };
  }
  return { aiSetting, apiKey: resolved.value };
}

async function handleFaqQuery(req, res, db, { userId = "" } = {}) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }
  try {
    const question = normalizeText(body.question);
    const audience = normalizeText(body.audience).toLowerCase() || "general";
    const language = normalizeText(body.language).toLowerCase() || "ja";
    if (!question) {
      return jsonError(res, 400, "VALIDATION_ERROR", "question is required", { failure_code: "validation_error" });
    }
    if (!SUPPORTED_FAQ_AUDIENCES.includes(audience)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "audience is not supported", { failure_code: "validation_error" });
    }
    if (!SUPPORTED_FAQ_LANGUAGES.includes(language)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "language is not supported", { failure_code: "validation_error" });
    }
    const resolved = resolveOpenAiFaqContext(db, userId, normalizeText(body.ai_setting_id));
    const answer = await generateFaqAnswer({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      question,
      audience,
      language,
    });
    recordFaqLifecycle({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      question,
      answer: answer.answer,
      audience: answer.audience,
      language: answer.language,
      confidence: answer.confidence,
      escalationHint: answer.escalation_hint,
      guardrailCode: answer.guardrail_code,
      evidenceRefs: answer.evidence_refs,
    });
    recordFaqQuery({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      audience: answer.audience,
      language: answer.language,
      status: answer.status,
      confidence: answer.confidence,
      escalationHint: answer.escalation_hint,
      guardrailCode: answer.guardrail_code,
      failureCode: answer.failure_code,
      tokenUsage: answer.token_usage,
    });
    return sendJson(res, 200, answer);
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "入力が不正です",
      error.details || { failure_code: "validation_error" }
    );
  }
}

module.exports = {
  handleFaqQuery,
};
