const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { getRun, listRunsByProject, parseRunIdInput } = require("../../api/runs");
const { getPersonalAiSetting, getDefaultPersonalAiSetting } = require("../personalAiSettingsStore");
const { parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { resolveSecretReference } = require("../openaiConnection");
const { generateRunSummary } = require("../../ai/runSummary");
const { generateHistorySummary, generateObservabilitySummary } = require("../../ai/workspaceSummary");
const { listHistory, summarizeHistoryPage } = require("../../db/history");
const { listWorkspaceMetrics } = require("../../db/workspaceMetrics");
const { recordAiSummaryRequest, recordSummaryGenerated } = require("../aiMetricsAudit");

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

function parseRunFilter(value) {
  const text = normalizeText(value);
  if (!text) return { runId: null, runInternalId: null };
  const parsed = parseRunIdInput(text);
  if (!parsed.ok) throw { status: parsed.status, code: parsed.code, message: parsed.message, details: parsed.details };
  return { runId: parsed.publicId, runInternalId: parsed.internalId };
}

function resolveAiSettingForSummary(db, userId, run, body = {}) {
  const explicitAiSettingId = normalizeText(body.ai_setting_id);
  if (explicitAiSettingId) {
    return getPersonalAiSetting(db, userId, explicitAiSettingId);
  }
  if (run && normalizeText(run.ai_setting_id)) {
    const item = getPersonalAiSetting(db, userId, run.ai_setting_id);
    if (item) return item;
  }
  return getDefaultPersonalAiSetting(db, userId);
}

async function handleRunAiSummary(req, res, db, { userId = "" } = {}) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  const runIdInput = req.url.split("/").filter(Boolean)[2];
  const parsedRunId = parseRunIdInput(runIdInput);
  if (!parsedRunId.ok) {
    return jsonError(res, parsedRunId.status, parsedRunId.code, parsedRunId.message, parsedRunId.details);
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }

  try {
    const run = getRun(db, parsedRunId.internalId);
    if (!run) {
      return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
    }

    const aiSetting = resolveAiSettingForSummary(db, userId, run, body);
    if (!aiSetting) {
      return jsonError(res, 400, "VALIDATION_ERROR", "default ai setting is not configured", {
        failure_code: "validation_error",
      });
    }
    if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
      return jsonError(res, 400, "VALIDATION_ERROR", "provider is not supported for run summary", {
        failure_code: "validation_error",
      });
    }

    const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
      fallbackEnvName: "OPENAI_API_KEY",
    });
    if (!resolved.ok) {
      return sendJson(res, 200, {
        provider: "openai",
        model: aiSetting.model || "",
        use_case: "run_summary",
        status: "error",
        error: resolved.error,
        failure_code: "unauthorized",
        latency_ms: 0,
        token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        run_id: run.run_id || "",
        thread_id: run.thread_id || "",
        summary: {
          overview: "",
          main_failure_reasons: [],
          priority_actions: [],
        },
        evidence_refs: {
          run_id: run.run_id || "",
          thread_id: run.thread_id || "",
          metric_snapshot: null,
          history_window: null,
          manual: [],
          runbook: [],
          doc_source: [],
        },
      });
    }

    let projectRuns = [];
    if (normalizeText(run.project_id)) {
      const parsedProjectId = parseProjectIdInput(run.project_id);
      if (parsedProjectId.ok) {
        projectRuns = listRunsByProject(db, parsedProjectId.internalId).slice(0, 10);
      }
    }

    const summary = await generateRunSummary({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.value,
      model: aiSetting.model || "",
      run,
      projectRuns,
    });
    recordAiSummaryRequest({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "run",
      projectId: normalizeText(run.project_id),
      threadId: normalizeText(run.thread_id),
      runId: normalizeText(run.run_id),
      status: summary.status,
      failureCode: summary.failure_code,
    });
    recordSummaryGenerated({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "run",
      projectId: normalizeText(run.project_id),
      threadId: normalizeText(run.thread_id),
      runId: normalizeText(run.run_id),
      summary: summary && summary.summary && summary.summary.overview,
      evidenceRefs: summary.evidence_refs,
      status: summary.status,
      failureCode: summary.failure_code,
    });
    return sendJson(res, 200, summary);
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "入力が不正です",
      error.details || { failure_code: error.failure_code || "validation_error" }
    );
  }
}

function resolveOpenAiSummaryContext(db, userId, explicitAiSettingId = "") {
  const aiSetting = explicitAiSettingId
    ? getPersonalAiSetting(db, userId, explicitAiSettingId)
    : getDefaultPersonalAiSetting(db, userId);
  if (!aiSetting) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "default ai setting is not configured", details: { failure_code: "validation_error" } };
  }
  if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
    throw { status: 400, code: "VALIDATION_ERROR", message: "provider is not supported for summary", details: { failure_code: "validation_error" } };
  }
  const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
    fallbackEnvName: "OPENAI_API_KEY",
  });
  if (!resolved.ok) {
    throw { status: 400, code: "VALIDATION_ERROR", message: resolved.error, details: { failure_code: "validation_error" } };
  }
  return { aiSetting, apiKey: resolved.value };
}

async function handleHistoryAiSummary(req, res, db, { userId = "" } = {}) {
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
    const project = parseProjectFilter(body.project_id);
    const thread = parseThreadFilter(body.thread_id);
    const run = parseRunFilter(body.run_id);
    const filters = {
      project_id: project.projectId,
      thread_id: thread.threadId,
      run_id: run.runId,
      event_type: normalizeList(body.event_type || body.event_types),
      provider: normalizeList(body.provider || body.provider_filter),
      status: normalizeList(body.status || body.status_filter),
      start_at: parseDateInput(body.start_at),
      end_at: parseDateInput(body.end_at),
    };
    const items = listHistory(db, {
      projectInternalId: project.projectInternalId,
      threadInternalId: thread.threadInternalId,
      runInternalId: run.runInternalId,
      startAt: filters.start_at,
      endAt: filters.end_at,
      eventTypes: filters.event_type,
      providers: filters.provider,
      statuses: filters.status,
    }).slice(0, 20);
    const summaries = summarizeHistoryPage(items);
    const resolved = resolveOpenAiSummaryContext(db, userId, normalizeText(body.ai_setting_id));
    const summary = await generateHistorySummary({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      payload: { items, day_groups: summaries.day_groups, run_summaries: summaries.run_summaries },
      filters,
    });
    recordAiSummaryRequest({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "history",
      projectId: project.projectId,
      threadId: filters.thread_id,
      runId: filters.run_id,
      status: summary.status,
      failureCode: summary.failure_code,
    });
    recordSummaryGenerated({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "history",
      projectId: project.projectId,
      threadId: filters.thread_id,
      runId: filters.run_id,
      summary: summary && summary.summary && summary.summary.overview,
      evidenceRefs: summary.evidence_refs,
      status: summary.status,
      failureCode: summary.failure_code,
    });
    return sendJson(res, 200, summary);
  } catch (error) {
    return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "入力が不正です", error.details || { failure_code: "validation_error" });
  }
}

async function handleObservabilityAiSummary(req, res, db, { userId = "" } = {}) {
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
    const resolved = resolveOpenAiSummaryContext(db, userId, normalizeText(body.ai_setting_id));
    const summary = await generateObservabilitySummary({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      payload,
      filters,
    });
    recordAiSummaryRequest({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "observability",
      projectId: project.projectId,
      threadId: filters.thread_id,
      status: summary.status,
      failureCode: summary.failure_code,
    });
    recordSummaryGenerated({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      summaryType: "observability",
      projectId: project.projectId,
      threadId: filters.thread_id,
      summary: summary && summary.summary && summary.summary.overview,
      evidenceRefs: summary.evidence_refs,
      status: summary.status,
      failureCode: summary.failure_code,
    });
    return sendJson(res, 200, summary);
  } catch (error) {
    return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "入力が不正です", error.details || { failure_code: "validation_error" });
  }
}

module.exports = {
  handleRunAiSummary,
  handleHistoryAiSummary,
  handleObservabilityAiSummary,
};
