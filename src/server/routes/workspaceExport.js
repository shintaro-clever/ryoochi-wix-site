"use strict";

const { readJsonBody, jsonError } = require("../../api/projects");
const { parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { parseRunIdInput, getRun, listRuns, listRunsByProject } = require("../../api/runs");
const { listHistory, summarizeHistoryPage } = require("../../db/history");
const { listWorkspaceMetrics } = require("../../db/workspaceMetrics");
const { listWorkspaceSearch, DEFAULT_SCOPES } = require("./workspaceSearch");

const ALLOWED_KINDS = new Set(["search", "history", "audit", "metrics"]);
const ALLOWED_FORMATS = new Set(["json", "csv"]);

const SEARCH_COLUMNS = Object.freeze([
  "entity",
  "id",
  "project_id",
  "thread_id",
  "run_id",
  "status",
  "title",
  "snippet",
  "created_at",
  "updated_at",
]);

const HISTORY_COLUMNS = Object.freeze([
  "event_id",
  "event_type",
  "provider",
  "status",
  "summary",
  "actor_requested_by",
  "actor_ai_setting_id",
  "actor_role",
  "project_id",
  "thread_id",
  "run_id",
  "message_id",
  "action_id",
  "recorded_at",
]);

const AUDIT_COLUMNS = Object.freeze([
  "run_id",
  "project_id",
  "thread_id",
  "status",
  "actor_requested_by",
  "read_plan_status",
  "read_confirm_required",
  "github_repository",
  "github_branch",
  "figma_file_key",
  "figma_frame_id",
  "write_plan_count",
  "write_actual_count",
  "figma_fidelity_status",
  "recorded_at",
]);

const METRICS_COLUMNS = Object.freeze([
  "section",
  "metric",
  "dimension_1",
  "dimension_2",
  "value",
]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validationDetails(reason, extra = {}) {
  return { failure_code: "validation_error", reason, ...extra };
}

function parseDateInput(value, fieldName) {
  const text = asText(value);
  if (!text) return "";
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw {
      status: 400,
      code: "VALIDATION_ERROR",
      message: `${fieldName} is invalid`,
      details: validationDetails(`invalid_${fieldName}`),
    };
  }
  return new Date(ms).toISOString();
}

function parseLimit(value, fallback = 200) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 1000) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "limit is invalid", details: validationDetails("invalid_limit") };
  }
  return num;
}

function normalizeList(value) {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const text = asText(item).toLowerCase();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

function parseProjectFilter(value) {
  const text = asText(value);
  if (!text) return { projectId: null, projectInternalId: null };
  const parsed = parseProjectIdInput(text);
  if (!parsed.ok) {
    throw { status: parsed.status, code: parsed.code, message: parsed.message, details: parsed.details };
  }
  return { projectId: parsed.publicId, projectInternalId: parsed.internalId };
}

function parseThreadFilter(value) {
  const text = asText(value);
  if (!text) return { threadId: null, threadInternalId: null };
  try {
    const parsed = parseThreadIdInput(text);
    return { threadId: parsed.publicId, threadInternalId: parsed.internalId };
  } catch (error) {
    throw { status: error.status || 400, code: error.code || "VALIDATION_ERROR", message: error.message || "thread_id is invalid", details: error.details || validationDetails("invalid_thread_id") };
  }
}

function parseRunFilter(value) {
  const text = asText(value);
  if (!text) return { runId: null, runInternalId: null };
  const parsed = parseRunIdInput(text);
  if (!parsed.ok) {
    throw { status: parsed.status, code: parsed.code, message: parsed.message, details: parsed.details };
  }
  return { runId: parsed.publicId, runInternalId: parsed.internalId };
}

function escapeCsv(value) {
  const text = String(value == null ? "" : value);
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function toCsv(columns, rows) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")).join("\n");
  return `${header}\n${body}`;
}

function sendExport(res, format, filename, payload, columns, rows) {
  if (format === "csv") {
    const csv = toCsv(columns, rows);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store",
    });
    return res.end(csv);
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.json"`,
    "Cache-Control": "no-store",
  });
  return res.end(JSON.stringify(payload, null, 2));
}

function buildSearchExport(db, criteria) {
  const items = listWorkspaceSearch(db, {
    query: asText(criteria.query),
    scopes: criteria.scope.length ? criteria.scope : Array.from(DEFAULT_SCOPES),
    projectId: criteria.projectId,
    projectInternalId: criteria.projectInternalId,
    threadId: criteria.threadInternalId,
    threadPublicId: criteria.threadId,
    limit: criteria.limit,
    offset: 0,
    startAt: criteria.startAt,
    endAt: criteria.endAt,
    statusFilter: criteria.statusFilter,
    providerFilter: criteria.providerFilter,
  }).slice(0, criteria.limit);
  const rows = items.map((item) => ({
    entity: item.entity || "",
    id: item.id || "",
    project_id: item.project_id || "",
    thread_id: item.thread_id || "",
    run_id: item.run_id || "",
    status: item.status || "",
    title: item.title || "",
    snippet: item.snippet || "",
    created_at: item.created_at || "",
    updated_at: item.updated_at || "",
  }));
  return {
    columns: SEARCH_COLUMNS,
    rows,
    payload: {
      kind: "search",
      exported_at: new Date().toISOString(),
      project_id: criteria.projectId,
      thread_id: criteria.threadId,
      format: criteria.format,
      columns: SEARCH_COLUMNS,
      items: rows,
    },
  };
}

function buildHistoryExport(db, criteria) {
  const items = listHistory(db, {
    projectInternalId: criteria.projectInternalId,
    threadInternalId: criteria.threadInternalId,
    runInternalId: criteria.runInternalId,
    startAt: criteria.startAt,
    endAt: criteria.endAt,
    eventTypes: criteria.eventTypes,
    providers: criteria.providerFilter,
    statuses: criteria.statusFilter,
  }).slice(0, criteria.limit);
  const summaries = summarizeHistoryPage(items);
  const rows = items.map((item) => {
    const actor = asObject(item.actor);
    const related = asObject(item.related_ids);
    return {
      event_id: item.event_id || "",
      event_type: item.event_type || "",
      provider: item.provider || "",
      status: item.status || "",
      summary: item.summary || "",
      actor_requested_by: actor.requested_by || "",
      actor_ai_setting_id: actor.ai_setting_id || "",
      actor_role: actor.role || "",
      project_id: related.project_id || "",
      thread_id: related.thread_id || "",
      run_id: related.run_id || "",
      message_id: related.message_id || "",
      action_id: related.action_id || "",
      recorded_at: item.recorded_at || "",
    };
  });
  return {
    columns: HISTORY_COLUMNS,
    rows,
    payload: {
      kind: "history",
      exported_at: new Date().toISOString(),
      project_id: criteria.projectId,
      thread_id: criteria.threadId,
      run_id: criteria.runId,
      format: criteria.format,
      columns: HISTORY_COLUMNS,
      day_groups: summaries.day_groups,
      run_summaries: summaries.run_summaries,
      items: rows,
    },
  };
}

function flattenAudit(run) {
  const audit = asObject(run && run.external_audit);
  const scope = asObject(audit.scope);
  const actor = asObject(audit.actor);
  const read = asObject(audit.read);
  const targets = asObject(read.targets);
  const github = asObject(targets.github);
  const figma = asObject(targets.figma);
  const fidelity = asObject(audit.figma_fidelity);
  return {
    run_id: run && run.run_id ? run.run_id : "",
    project_id: scope.project_id || run.project_id || "",
    thread_id: actor.thread_id || run.thread_id || "",
    status: scope.status || run.status || "",
    actor_requested_by: actor.requested_by || "",
    read_plan_status: read.plan_status || "",
    read_confirm_required: read.confirm_required === null ? "" : String(Boolean(read.confirm_required)),
    github_repository: github.repository || "",
    github_branch: github.branch || "",
    figma_file_key: figma.file_key || "",
    figma_frame_id: figma.frame_id || "",
    write_plan_count: asArray(audit.write_plan).length,
    write_actual_count: asArray(audit.write_actual).length,
    figma_fidelity_status: fidelity.status || "",
    recorded_at: audit.recorded_at || audit.projected_at || run.updated_at || run.created_at || "",
  };
}

function buildAuditExport(db, criteria) {
  const runs = criteria.runInternalId
    ? (() => {
        const item = getRun(db, criteria.runInternalId);
        return item ? [item] : [];
      })()
    : criteria.projectInternalId
      ? listRunsByProject(db, criteria.projectInternalId)
      : listRuns(db);
  const filtered = runs
    .filter((run) => !criteria.threadId || String(run.thread_id || "") === String(criteria.threadId))
    .filter((run) => {
      const row = flattenAudit(run);
      return row.recorded_at && (!criteria.startAt || row.recorded_at >= criteria.startAt) && (!criteria.endAt || row.recorded_at <= criteria.endAt);
    })
    .slice(0, criteria.limit);
  const rows = filtered.map((run) => flattenAudit(run));
  return {
    columns: AUDIT_COLUMNS,
    rows,
    payload: {
      kind: "audit",
      exported_at: new Date().toISOString(),
      project_id: criteria.projectId,
      thread_id: criteria.threadId,
      run_id: criteria.runId,
      format: criteria.format,
      columns: AUDIT_COLUMNS,
      items: rows,
    },
  };
}

function buildMetricsRows(metrics) {
  const rows = [];
  const push = (section, metric, value, dimension1 = "", dimension2 = "") => {
    rows.push({ section, metric, dimension_1: dimension1, dimension_2: dimension2, value: value == null ? "" : String(value) });
  };
  push("run_counts", "total", metrics.run_counts.total);
  Object.entries(metrics.run_counts.by_status || {}).forEach(([key, value]) => push("run_counts", "by_status", value, key));
  asArray(metrics.operation_counts.by_provider).forEach((entry) => push("operation_counts", "by_provider", entry.count, entry.provider));
  asArray(metrics.failure_code_distribution.by_provider).forEach((entry) => push("failure_code_distribution", "by_provider", entry.count, entry.provider, entry.failure_code));
  asArray(metrics.figma_fidelity_distribution.score_bands).forEach((entry) => push("figma_fidelity_distribution", "score_band", entry.count, entry.band));
  asArray(metrics.anomalies.items).forEach((entry) => push("anomalies", entry.code, entry.severity, entry.title));
  push("duration", "median_ms", metrics.duration.median_ms);
  push("duration", "p95_ms", metrics.duration.p95_ms);
  push("confirm_rate", "rate", metrics.confirm_rate.total.rate);
  return rows;
}

function buildMetricsExport(db, criteria) {
  const metrics = listWorkspaceMetrics(db, {
    projectId: criteria.projectId,
    projectInternalId: criteria.projectInternalId,
    threadId: criteria.threadId,
    threadInternalId: criteria.threadInternalId,
    providers: criteria.providerFilter,
    startAt: criteria.startAt,
    endAt: criteria.endAt,
  });
  const rows = buildMetricsRows(metrics);
  return {
    columns: METRICS_COLUMNS,
    rows,
    payload: {
      kind: "metrics",
      exported_at: new Date().toISOString(),
      project_id: criteria.projectId,
      thread_id: criteria.threadId,
      format: criteria.format,
      columns: METRICS_COLUMNS,
      data: metrics,
    },
  };
}

async function handleWorkspaceExport(req, res, db) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", validationDetails("invalid_json"));
  }

  try {
    const kind = asText(body.kind).toLowerCase();
    const format = asText(body.format).toLowerCase() || "json";
    if (!ALLOWED_KINDS.has(kind)) {
      throw { status: 400, code: "VALIDATION_ERROR", message: "kind is invalid", details: validationDetails("invalid_kind") };
    }
    if (!ALLOWED_FORMATS.has(format)) {
      throw { status: 400, code: "VALIDATION_ERROR", message: "format is invalid", details: validationDetails("invalid_format") };
    }
    const project = parseProjectFilter(body.project_id);
    const thread = parseThreadFilter(body.thread_id);
    const run = parseRunFilter(body.run_id);
    const criteria = {
      kind,
      format,
      limit: parseLimit(body.limit, 500),
      query: asText(body.query),
      scope: normalizeList(body.scope),
      projectId: project.projectId,
      projectInternalId: project.projectInternalId,
      threadId: thread.threadId,
      threadInternalId: thread.threadInternalId,
      runId: run.runId,
      runInternalId: run.runInternalId,
      startAt: parseDateInput(body.start_at || body.time_from, "start_at"),
      endAt: parseDateInput(body.end_at || body.time_to, "end_at"),
      statusFilter: normalizeList(body.status || body.status_filter),
      providerFilter: normalizeList(body.provider || body.provider_filter),
      eventTypes: normalizeList(body.event_type || body.event_types),
    };

    const filename = `workspace-${kind}-export`;
    const builder =
      kind === "search"
        ? buildSearchExport
        : kind === "history"
          ? buildHistoryExport
          : kind === "audit"
            ? buildAuditExport
            : buildMetricsExport;
    const built = builder(db, criteria);
    return sendExport(res, format, filename, built.payload, built.columns, built.rows);
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "入力が不正です",
      error.details || validationDetails(error.failure_code || "validation_error")
    );
  }
}

module.exports = {
  handleWorkspaceExport,
  SEARCH_COLUMNS,
  HISTORY_COLUMNS,
  AUDIT_COLUMNS,
  METRICS_COLUMNS,
};
