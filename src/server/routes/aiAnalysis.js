const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { getPersonalAiSetting, getDefaultPersonalAiSetting } = require("../personalAiSettingsStore");
const { parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { resolveSecretReference } = require("../openaiConnection");
const { listWorkspaceMetrics } = require("../../db/workspaceMetrics");
const { SUPPORTED_ALERT_CODES, generateObservabilityAnalysis } = require("../../ai/observabilityAnalysis");
const { recordAiAnalysisRequest, recordAnalysisGenerated } = require("../aiMetricsAudit");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeList(value) {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((item) => normalizeText(item).toLowerCase()).filter(Boolean);
}

function parseDateInput(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "date is invalid", details: { failure_code: "validation_error" } };
  }
  return new Date(ms).toISOString();
}

function parseProjectFilter(value) {
  const text = normalizeText(value);
  if (!text) return { projectId: null, projectInternalId: null };
  const parsed = parseProjectIdInput(text);
  if (!parsed.ok) throw { status: parsed.status, code: parsed.code, message: parsed.message, details: parsed.details };
  return { projectId: parsed.publicId, projectInternalId: parsed.internalId };
}

function parseThreadFilter(value) {
  const text = normalizeText(value);
  if (!text) return { threadId: null, threadInternalId: null };
  try {
    const parsed = parseThreadIdInput(text);
    return { threadId: parsed.publicId, threadInternalId: parsed.internalId };
  } catch (error) {
    throw { status: error.status || 400, code: error.code || "VALIDATION_ERROR", message: error.message || "thread_id is invalid", details: error.details || { failure_code: "validation_error" } };
  }
}

function resolveOpenAiAnalysisContext(db, userId, explicitAiSettingId = "") {
  const aiSetting = explicitAiSettingId
    ? getPersonalAiSetting(db, userId, explicitAiSettingId)
    : getDefaultPersonalAiSetting(db, userId);
  if (!aiSetting) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "default ai setting is not configured", details: { failure_code: "validation_error" } };
  }
  if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
    throw { status: 400, code: "VALIDATION_ERROR", message: "provider is not supported for analysis", details: { failure_code: "validation_error" } };
  }
  const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
    fallbackEnvName: "OPENAI_API_KEY",
  });
  if (!resolved.ok) {
    throw { status: 400, code: "VALIDATION_ERROR", message: resolved.error, details: { failure_code: "validation_error" } };
  }
  return { aiSetting, apiKey: resolved.value };
}

async function handleObservabilityAiAnalysis(req, res, db, { userId = "" } = {}) {
  if (req.method !== "POST") {
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
    const alertCode = normalizeText(body.alert_code || body.anomaly_code).toLowerCase();
    if (!SUPPORTED_ALERT_CODES.includes(alertCode)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "alert_code is not supported", { failure_code: "validation_error" });
    }
    const project = parseProjectFilter(body.project_id);
    const thread = parseThreadFilter(body.thread_id);
    const filters = {
      project_id: project.projectId,
      thread_id: thread.threadId,
      provider: normalizeList(body.provider || body.provider_filter),
      start_at: parseDateInput(body.start_at),
      end_at: parseDateInput(body.end_at),
    };
    const payload = listWorkspaceMetrics(db, {
      projectId: project.projectId,
      projectInternalId: project.projectInternalId,
      threadId: thread.threadId,
      threadInternalId: thread.threadInternalId,
      providers: filters.provider,
      startAt: filters.start_at,
      endAt: filters.end_at,
    });
    const alert = Array.isArray(payload && payload.anomalies && payload.anomalies.items)
      ? payload.anomalies.items.find((item) => normalizeText(item && item.code).toLowerCase() === alertCode)
      : null;
    if (!alert) {
      return jsonError(res, 404, "NOT_FOUND", "alert not found in selected window", { failure_code: "not_found" });
    }
    const resolved = resolveOpenAiAnalysisContext(db, userId, normalizeText(body.ai_setting_id));
    const analysis = await generateObservabilityAnalysis({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      payload,
      filters,
      alert,
    });
    recordAiAnalysisRequest({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      analysisType: "observability",
      alertCode,
      projectId: project.projectId,
      threadId: filters.thread_id,
      status: analysis.status,
      failureCode: analysis.failure_code,
    });
    recordAnalysisGenerated({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      analysisType: "observability",
      alertCode,
      projectId: project.projectId,
      threadId: filters.thread_id,
      analysis: Array.isArray(analysis && analysis.analysis && analysis.analysis.candidate_causes)
        ? analysis.analysis.candidate_causes.join(" / ")
        : "",
      evidenceRefs: analysis.evidence_refs,
      status: analysis.status,
      failureCode: analysis.failure_code,
    });
    return sendJson(res, 200, analysis);
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
  handleObservabilityAiAnalysis,
};
