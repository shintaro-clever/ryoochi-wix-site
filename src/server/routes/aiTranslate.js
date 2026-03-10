const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { getPersonalAiSetting, getDefaultPersonalAiSetting } = require("../personalAiSettingsStore");
const { resolveSecretReference } = require("../openaiConnection");
const {
  SUPPORTED_TRANSLATE_USE_CASES,
  SUPPORTED_TARGET_LANGUAGES,
  translateAssistPayload,
} = require("../../ai/aiTranslate");
const { recordAiTranslationRequest, recordTranslationGenerated } = require("../aiMetricsAudit");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function inferScopeFromEvidenceRefs(evidenceRefs) {
  const refs = asObject(evidenceRefs);
  const historyWindow = asObject(refs.history_window);
  return {
    projectId: normalizeText(historyWindow.project_id),
    threadId: normalizeText(refs.thread_id),
    runId: normalizeText(refs.run_id),
  };
}

function resolveOpenAiTranslateContext(db, userId, explicitAiSettingId = "") {
  const aiSetting = explicitAiSettingId
    ? getPersonalAiSetting(db, userId, explicitAiSettingId)
    : getDefaultPersonalAiSetting(db, userId);
  if (!aiSetting) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "default ai setting is not configured", details: { failure_code: "validation_error" } };
  }
  if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
    throw { status: 400, code: "VALIDATION_ERROR", message: "provider is not supported for translate", details: { failure_code: "validation_error" } };
  }
  const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
    fallbackEnvName: "OPENAI_API_KEY",
  });
  if (!resolved.ok) {
    throw { status: 400, code: "VALIDATION_ERROR", message: resolved.error, details: { failure_code: "validation_error" } };
  }
  return { aiSetting, apiKey: resolved.value };
}

async function handleAiTranslate(req, res, db, { userId = "" } = {}) {
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
    const sourceUseCase = normalizeText(body.source_use_case).toLowerCase();
    const targetLanguage = normalizeText(body.target_language).toLowerCase();
    if (!SUPPORTED_TRANSLATE_USE_CASES.includes(sourceUseCase)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "source_use_case is not supported", { failure_code: "validation_error" });
    }
    if (!SUPPORTED_TARGET_LANGUAGES.includes(targetLanguage)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "target_language is not supported", { failure_code: "validation_error" });
    }
    const resolved = resolveOpenAiTranslateContext(db, userId, normalizeText(body.ai_setting_id));
    const translated = await translateAssistPayload({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      source_use_case: sourceUseCase,
      target_language: targetLanguage,
      payload: asObject(body.payload),
      evidence_refs: asObject(body.evidence_refs),
    });
    recordAiTranslationRequest({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      sourceUseCase: sourceUseCase,
      targetLanguage: targetLanguage,
      ...inferScopeFromEvidenceRefs(body.evidence_refs),
      status: translated.status,
      failureCode: translated.failure_code,
    });
    recordTranslationGenerated({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      sourceUseCase: sourceUseCase,
      targetLanguage: targetLanguage,
      ...inferScopeFromEvidenceRefs(body.evidence_refs),
      translated: JSON.stringify(translated && translated.translated ? translated.translated : {}),
      evidenceRefs: translated.evidence_refs,
      status: translated.status,
      failureCode: translated.failure_code,
    });
    return sendJson(res, 200, translated);
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
  handleAiTranslate,
};
