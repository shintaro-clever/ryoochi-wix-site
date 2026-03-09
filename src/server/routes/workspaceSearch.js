"use strict";

const { Buffer } = require("buffer");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { listProjects, parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { KINDS, buildPublicId, isUuid } = require("../../id/publicIds");
const { recordWorkspaceSearchAudit } = require("../../audit/search");

const ALLOWED_SCOPES = Object.freeze([
  "project",
  "thread",
  "run",
  "message",
  "external_operation",
  "external_audit",
]);

const DEFAULT_SCOPES = Object.freeze([
  "project",
  "thread",
  "run",
  "external_operation",
  "external_audit",
]);
const ALLOWED_PROVIDERS = Object.freeze(["github", "figma"]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toPublicId(kind, value) {
  const text = asText(value);
  if (!text) return null;
  return isUuid(text) ? buildPublicId(kind, text) : text;
}

function parseJsonSafe(value) {
  const text = asText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function validationDetails(reason, extra = {}) {
  return { failure_code: "validation_error", reason, ...extra };
}

function normalizeQuery(value) {
  return asText(value).slice(0, 500);
}

function parseLimit(value) {
  if (value === undefined || value === null || value === "") return 20;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 100) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "limit is invalid", details: validationDetails("invalid_limit") };
  }
  return num;
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64");
}

function parseCursor(value) {
  const text = asText(value);
  if (!text) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
    const offset = Number(decoded && decoded.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("invalid");
    return offset;
  } catch {
    throw { status: 400, code: "VALIDATION_ERROR", message: "cursor is invalid", details: validationDetails("invalid_cursor") };
  }
}

function parseScopes(value) {
  if (value === undefined || value === null || value === "") return Array.from(DEFAULT_SCOPES);
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const scope = asText(item).toLowerCase();
    if (!scope || seen.has(scope)) return;
    if (!ALLOWED_SCOPES.includes(scope)) {
      throw {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "scope is invalid",
        details: validationDetails("invalid_scope", { scope }),
      };
    }
    seen.add(scope);
    out.push(scope);
  });
  return out.length > 0 ? out : Array.from(DEFAULT_SCOPES);
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

function parseStatusFilter(value) {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((item) => asText(item).toLowerCase()).filter(Boolean).slice(0, 20);
}

function parseProviderFilter(value) {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const provider = asText(item).toLowerCase();
    if (!provider || seen.has(provider)) return;
    if (!ALLOWED_PROVIDERS.includes(provider)) {
      throw {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "provider_filter is invalid",
        details: validationDetails("invalid_provider_filter", { provider }),
      };
    }
    seen.add(provider);
    out.push(provider);
  });
  return out;
}

function sanitizeSecretLike(text) {
  let value = asText(text);
  if (!value) return "";
  const patterns = [
    /(env|vault):\/\/[^\s"'`]+/gi,
    /\b(ghp|gho|ghu|ghs|ghr|github_pat|sk|figd|figma)_[A-Za-z0-9_-]+\b/gi,
    /\bconfirm_token\s*=\s*[^\s,;]+/gi,
    /\bsecret_id\s*=\s*[^\s,;]+/gi,
    /\b(token|password|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
  ];
  patterns.forEach((pattern) => {
    value = value.replace(pattern, "[redacted]");
  });
  return value;
}

function summarizeText(value, max = 160) {
  const text = sanitizeSecretLike(asText(value).replace(/\s+/g, " "));
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function containsQuery(parts, query) {
  const normalizedQuery = asText(query).toLowerCase();
  if (!normalizedQuery) return true;
  return parts.some((part) => asText(part).toLowerCase().includes(normalizedQuery));
}

function withinTimeRange(ts, start, end) {
  const value = asText(ts);
  if (!value) return false;
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function matchStatus(status, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.includes(asText(status).toLowerCase());
}

function collectProjects(db, criteria) {
  const payload = listProjects(db);
  const projects = Array.isArray(payload && payload.projects) ? payload.projects : [];
  return projects
    .filter((project) => {
      if (criteria.projectId && project.project_id !== criteria.projectId) return false;
      if (!withinTimeRange(project.updated_at || project.created_at, criteria.startAt, criteria.endAt)) return false;
      return containsQuery([project.project_id, project.name, project.staging_url, project.description], criteria.query);
    })
    .map((project) => ({
      entity: "project",
      id: project.project_id,
      project_id: project.project_id,
      thread_id: null,
      status: project.status || "active",
      title: project.name || "",
      snippet: summarizeText(project.description || project.staging_url || ""),
      created_at: project.created_at || null,
      updated_at: project.updated_at || null,
    }));
}

function listThreadsRaw(db, projectId = "") {
  const sql = projectId
    ? `SELECT t.id AS thread_id, t.project_id, t.title, t.created_at, t.updated_at,
         (SELECT MAX(m.created_at) FROM thread_messages m WHERE m.tenant_id=t.tenant_id AND m.thread_id=t.id) AS last_message_at,
         (SELECT COALESCE(NULLIF(m.content, ''), m.body, '') FROM thread_messages m WHERE m.tenant_id=t.tenant_id AND m.thread_id=t.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_content
       FROM project_threads t
       WHERE t.tenant_id=? AND t.project_id=?
       ORDER BY t.updated_at DESC`
    : `SELECT t.id AS thread_id, t.project_id, t.title, t.created_at, t.updated_at,
         (SELECT MAX(m.created_at) FROM thread_messages m WHERE m.tenant_id=t.tenant_id AND m.thread_id=t.id) AS last_message_at,
         (SELECT COALESCE(NULLIF(m.content, ''), m.body, '') FROM thread_messages m WHERE m.tenant_id=t.tenant_id AND m.thread_id=t.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_content
       FROM project_threads t
       WHERE t.tenant_id=?
       ORDER BY t.updated_at DESC`;
  return projectId ? db.prepare(sql).all(DEFAULT_TENANT, projectId) : db.prepare(sql).all(DEFAULT_TENANT);
}

function collectThreads(db, criteria) {
  return listThreadsRaw(db, criteria.projectInternalId)
    .filter((thread) => {
      if (criteria.threadId && thread.thread_id !== criteria.threadId) return false;
      if (!withinTimeRange(thread.updated_at || thread.created_at, criteria.startAt, criteria.endAt)) return false;
      return containsQuery([thread.thread_id, thread.title, thread.latest_message_content], criteria.query);
    })
    .map((thread) => ({
      entity: "thread",
      id: toPublicId(KINDS.thread, thread.thread_id),
      project_id: toPublicId(KINDS.project, thread.project_id),
      thread_id: toPublicId(KINDS.thread, thread.thread_id),
      status: "active",
      title: thread.title || "",
      snippet: summarizeText(thread.latest_message_content || ""),
      created_at: thread.created_at || null,
      updated_at: thread.updated_at || null,
    }));
}

function collectMessages(db, criteria) {
  const sql =
    criteria.threadId
      ? `SELECT m.id AS message_id, m.thread_id, t.project_id, m.role, m.content, m.body, m.created_at
         FROM thread_messages m
         JOIN project_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
         WHERE m.tenant_id=? AND m.thread_id=?
         ORDER BY m.created_at DESC`
      : criteria.projectInternalId
        ? `SELECT m.id AS message_id, m.thread_id, t.project_id, m.role, m.content, m.body, m.created_at
           FROM thread_messages m
           JOIN project_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
           WHERE m.tenant_id=? AND t.project_id=?
           ORDER BY m.created_at DESC`
        : `SELECT m.id AS message_id, m.thread_id, t.project_id, m.role, m.content, m.body, m.created_at
           FROM thread_messages m
           JOIN project_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
           WHERE m.tenant_id=?
           ORDER BY m.created_at DESC`;
  const rows = criteria.threadId
    ? db.prepare(sql).all(DEFAULT_TENANT, criteria.threadId)
    : criteria.projectInternalId
      ? db.prepare(sql).all(DEFAULT_TENANT, criteria.projectInternalId)
      : db.prepare(sql).all(DEFAULT_TENANT);
  return rows
    .filter((message) => {
      if (!withinTimeRange(message.created_at, criteria.startAt, criteria.endAt)) return false;
      return containsQuery([message.message_id, message.thread_id, message.role, summarizeText(message.content || message.body)], criteria.query);
    })
    .map((message) => ({
      entity: "message",
      id: message.message_id,
      project_id: toPublicId(KINDS.project, message.project_id),
      thread_id: toPublicId(KINDS.thread, message.thread_id),
      status: asText(message.role) || "message",
      title: asText(message.role) || "message",
      snippet: summarizeText(message.content || message.body),
      created_at: message.created_at || null,
      updated_at: message.created_at || null,
    }));
}

function collectRunsAndDerived(db, criteria) {
  const statusFilter = Array.isArray(criteria && criteria.statusFilter) ? criteria.statusFilter : [];
  const providerFilter = Array.isArray(criteria && criteria.providerFilter) ? criteria.providerFilter : [];
  const runOnlyStatusFilter =
    statusFilter.length > 0 &&
    criteria.scopes.includes("run") &&
    !criteria.scopes.includes("external_operation") &&
    !criteria.scopes.includes("external_audit");
  const runOnlyProviderFilter =
    providerFilter.length > 0 &&
    criteria.scopes.includes("run") &&
    !criteria.scopes.includes("external_operation") &&
    !criteria.scopes.includes("external_audit");
  const params = [DEFAULT_TENANT];
  const where = ["tenant_id=?"];
  if (criteria.projectInternalId) {
    where.push("project_id=?");
    params.push(criteria.projectInternalId);
  }
  if (criteria.threadId) {
    where.push("thread_id=?");
    params.push(criteria.threadId);
  }
  if (runOnlyStatusFilter) {
    const placeholders = statusFilter.map(() => "?").join(",");
    where.push(`status IN (${placeholders})`);
    params.push(...statusFilter);
  }
  if (runOnlyProviderFilter) {
    const placeholders = providerFilter.map(() => "?").join(",");
    where.push(`search_provider IN (${placeholders})`);
    params.push(...providerFilter);
  }
  if (criteria.startAt) {
    where.push("updated_at>=?");
    params.push(criteria.startAt);
  }
  if (criteria.endAt) {
    where.push("updated_at<=?");
    params.push(criteria.endAt);
  }
  const rows = db
    .prepare(
      `SELECT id, project_id, thread_id, status, job_type, failure_code, target_path, inputs_json, search_requested_by, search_provider, created_at, updated_at
       FROM runs
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, Math.max(criteria.offset + criteria.limit + 100, 200), 0)
    .map((row) => {
      const inputs = parseJsonSafe(row.inputs_json);
      const contextUsed = asObject(inputs.context_used);
      const externalOperations = Array.isArray(inputs.external_operations)
        ? inputs.external_operations
        : Array.isArray(contextUsed.external_operations)
          ? contextUsed.external_operations
          : [];
      const externalAudit = asObject(contextUsed.external_audit) || asObject(inputs.external_audit);
      return {
        run_id: toPublicId(KINDS.run, row.id),
        project_id: toPublicId(KINDS.project, row.project_id),
        thread_id: toPublicId(KINDS.thread, row.thread_id),
        status: row.status,
        job_type: row.job_type,
        failure_code: row.failure_code,
        target_path: row.target_path,
        search_requested_by: row.search_requested_by || "",
        search_provider: row.search_provider || "",
        external_operations: externalOperations,
        external_audit: externalAudit,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  const runs = [];
  const externalOperations = [];
  const externalAudit = [];
  rows.forEach((run) => {
    if (!withinTimeRange(run.updated_at || run.created_at, criteria.startAt, criteria.endAt)) return;

    if ((providerFilter.length === 0 || providerFilter.includes(asText(run.search_provider).toLowerCase())) &&
        containsQuery([run.run_id, run.project_id, run.thread_id, run.status, run.job_type, run.failure_code, run.target_path, run.search_requested_by, run.search_provider], criteria.query) &&
        matchStatus(run.status, statusFilter)) {
      runs.push({
        entity: "run",
        id: run.run_id,
        project_id: run.project_id,
        thread_id: run.thread_id || null,
        status: run.status || "",
        title: run.job_type || "run",
        snippet: summarizeText(`${run.failure_code || ""} ${run.target_path || ""}`),
        created_at: run.created_at || null,
        updated_at: run.updated_at || null,
      });
    }

    (Array.isArray(run.external_operations) ? run.external_operations : []).forEach((entry, index) => {
      const target = asObject(entry && entry.target);
      const result = asObject(entry && entry.result);
      const recordedAt = asText(entry && entry.recorded_at) || run.updated_at || run.created_at;
      if (!withinTimeRange(recordedAt, criteria.startAt, criteria.endAt)) return;
      const status = asText(result.status).toLowerCase() || "unknown";
      if (!matchStatus(status, statusFilter)) return;
      const provider = asText(entry && entry.provider).toLowerCase();
      if (providerFilter.length > 0 && !providerFilter.includes(provider)) return;
      const parts = [
        entry && entry.provider,
        entry && entry.operation_type,
        target.repository,
        target.branch,
        target.path,
        target.file_key,
        result.status,
        result.failure_code,
        result.reason,
      ];
      if (!containsQuery(parts, criteria.query)) return;
      externalOperations.push({
        entity: "external_operation",
        id: `${run.run_id}:external_operation:${index + 1}`,
        project_id: run.project_id,
        thread_id: run.thread_id || null,
        run_id: run.run_id,
        status,
        title: `${asText(entry && entry.provider) || "external"}:${asText(entry && entry.operation_type) || "-"}`,
        snippet: summarizeText(`${target.repository || target.file_key || target.path || ""} ${result.failure_code || result.reason || ""}`),
        created_at: recordedAt,
        updated_at: recordedAt,
      });
    });

    const audit = asObject(run.external_audit);
    if (Object.keys(audit).length > 0) {
      const scope = asObject(audit.scope);
      const read = asObject(audit.read);
      const fidelity = asObject(audit.figma_fidelity);
      const recordedAt = run.updated_at || run.created_at;
      const status = asText(scope.status).toLowerCase() || "unknown";
      const readTargets = asObject(read.targets);
      const auditProviders = [
        readTargets.github ? "github" : "",
        readTargets.figma ? "figma" : "",
        run.search_provider,
      ].map((item) => asText(item).toLowerCase()).filter(Boolean);
      if (withinTimeRange(recordedAt, criteria.startAt, criteria.endAt) &&
          (providerFilter.length === 0 || providerFilter.some((provider) => auditProviders.includes(provider))) &&
          matchStatus(status, statusFilter) &&
          containsQuery([
            asObject(audit.actor).requested_by,
            scope.project_id,
            scope.run_id,
            scope.status,
            read.plan_status,
            JSON.stringify(read.targets || {}),
            fidelity.status,
          ], criteria.query)) {
        externalAudit.push({
          entity: "external_audit",
          id: `${run.run_id}:external_audit`,
          project_id: run.project_id,
          thread_id: run.thread_id || null,
          run_id: run.run_id,
          status,
          title: "external_audit",
          snippet: summarizeText(`${read.plan_status || ""} ${fidelity.status || ""}`),
          created_at: run.created_at || null,
          updated_at: recordedAt,
        });
      }
    }
  });
  return { runs, externalOperations, externalAudit };
}

function sortItems(items) {
  return items.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

function listWorkspaceSearch(db, criteria) {
  let items = [];
  if (criteria.scopes.includes("project")) items = items.concat(collectProjects(db, criteria));
  if (criteria.scopes.includes("thread")) items = items.concat(collectThreads(db, criteria));
  if (criteria.scopes.includes("message")) items = items.concat(collectMessages(db, criteria));
  if (
    criteria.scopes.includes("run") ||
    criteria.scopes.includes("external_operation") ||
    criteria.scopes.includes("external_audit")
  ) {
    const derived = collectRunsAndDerived(db, criteria);
    if (criteria.scopes.includes("run")) items = items.concat(derived.runs);
    if (criteria.scopes.includes("external_operation")) items = items.concat(derived.externalOperations);
    if (criteria.scopes.includes("external_audit")) items = items.concat(derived.externalAudit);
  }
  return sortItems(items);
}

async function parseRequest(req) {
  if ((req.method || "GET").toUpperCase() === "POST") {
    try {
      return await readJsonBody(req);
    } catch {
      throw { status: 400, code: "VALIDATION_ERROR", message: "JSONが不正です", details: validationDetails("invalid_json") };
    }
  }
  const url = new URL(req.url || "/", "http://localhost");
  const scopeAll = url.searchParams.getAll("scope");
  return {
    query: url.searchParams.get("query"),
    scope: scopeAll.length > 1 ? scopeAll : url.searchParams.get("scope"),
    project_id: url.searchParams.get("project_id"),
    thread_id: url.searchParams.get("thread_id"),
    limit: url.searchParams.get("limit"),
    cursor: url.searchParams.get("cursor"),
    time_from: url.searchParams.get("time_from") || url.searchParams.get("start_at"),
    time_to: url.searchParams.get("time_to") || url.searchParams.get("end_at"),
    status_filter: url.searchParams.getAll("status_filter").length > 1
      ? url.searchParams.getAll("status_filter")
      : url.searchParams.get("status_filter") || url.searchParams.get("status"),
    provider_filter: url.searchParams.getAll("provider_filter").length > 1
      ? url.searchParams.getAll("provider_filter")
      : url.searchParams.get("provider_filter") || url.searchParams.get("provider"),
  };
}

async function handleWorkspaceSearch(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  let body;
  try {
    body = await parseRequest(req);
  } catch (error) {
    if (error && error.stack) {
      console.warn("[workspace_search]", error.stack);
    }
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "validation error",
      error.details || validationDetails("validation_error")
    );
  }

  try {
    const projectIdInput = asText(body.project_id);
    const threadIdInput = asText(body.thread_id);
    let projectInternalId = "";
    let projectPublicId = "";
    if (projectIdInput) {
      const parsedProject = parseProjectIdInput(projectIdInput);
      if (!parsedProject.ok) throw parsedProject;
      projectInternalId = parsedProject.internalId;
      projectPublicId = parsedProject.publicId;
    }
    let threadInternalId = "";
    let threadPublicId = "";
    if (threadIdInput) {
      const parsedThread = parseThreadIdInput(threadIdInput);
      threadInternalId = parsedThread.internalId;
      threadPublicId = parsedThread.publicId;
    }
    const criteria = {
      query: normalizeQuery(body.query),
      scopes: parseScopes(body.scope),
      projectId: projectPublicId,
      projectInternalId,
      threadId: threadInternalId,
      threadPublicId,
      limit: parseLimit(body.limit),
      offset: parseCursor(body.cursor),
      startAt: parseDateInput(body.time_from, "time_from"),
      endAt: parseDateInput(body.time_to, "time_to"),
      statusFilter: parseStatusFilter(body.status_filter),
      providerFilter: parseProviderFilter(body.provider_filter),
    };

    const sorted = listWorkspaceSearch(db, criteria);
    const paged = sorted.slice(criteria.offset, criteria.offset + criteria.limit);
    const nextCursor =
      criteria.offset + criteria.limit < sorted.length ? encodeCursor(criteria.offset + criteria.limit) : null;

    recordWorkspaceSearchAudit(req, db, {
      projectId: projectPublicId,
      threadId: threadPublicId,
      scopes: criteria.scopes,
      statusFilter: criteria.statusFilter,
      providerFilter: criteria.providerFilter,
      query: criteria.query,
      resultCount: sorted.length,
    });

    return sendJson(res, 200, {
      query: criteria.query,
      scopes: criteria.scopes,
      project_id: projectPublicId || null,
      thread_id: threadPublicId || null,
      limit: criteria.limit,
      cursor: body.cursor ? asText(body.cursor) : null,
      provider_filter: criteria.providerFilter,
      status_filter: criteria.statusFilter,
      next_cursor: nextCursor,
      total_estimated: sorted.length,
      items: paged,
    });
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "validation error",
      error.details || validationDetails(error.failure_code || "validation_error")
    );
  }
}

module.exports = {
  handleWorkspaceSearch,
  ALLOWED_SCOPES,
  DEFAULT_SCOPES,
  listWorkspaceSearch,
};
