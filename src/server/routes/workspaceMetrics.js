"use strict";

const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { listWorkspaceMetrics } = require("../../db/workspaceMetrics");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validationDetails(reason, extra = {}) {
  return { failure_code: "validation_error", reason, ...extra };
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
    throw {
      status: error.status || 400,
      code: error.code || "VALIDATION_ERROR",
      message: error.message || "thread_id is invalid",
      details: error.details || validationDetails("invalid_thread_id"),
    };
  }
}

async function readCriteria(req) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET") {
    return {};
  }
  if (method === "POST") {
    return await readJsonBody(req);
  }
  throw { status: 405, code: "METHOD_NOT_ALLOWED", message: "Method not allowed", details: {} };
}

async function handleWorkspaceMetrics(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }

  let body = {};
  if (method === "POST") {
    try {
      body = await readCriteria(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", validationDetails("invalid_json"));
    }
  }

  const url = new URL(req.url || "/", "http://localhost");
  const source =
    method === "GET"
      ? {
          project_id: url.searchParams.get("project_id"),
          thread_id: url.searchParams.get("thread_id"),
          provider:
            url.searchParams.getAll("provider").length > 1
              ? url.searchParams.getAll("provider")
              : url.searchParams.get("provider") || url.searchParams.get("provider_filter"),
          start_at: url.searchParams.get("start_at") || url.searchParams.get("recorded_from"),
          end_at: url.searchParams.get("end_at") || url.searchParams.get("recorded_to"),
        }
      : body || {};

  try {
    const project = parseProjectFilter(source.project_id);
    const thread = parseThreadFilter(source.thread_id);
    const providers = normalizeList(source.provider || source.provider_filter);
    const startAt = parseDateInput(source.start_at || source.recorded_from, "start_at");
    const endAt = parseDateInput(source.end_at || source.recorded_to, "end_at");

    const payload = listWorkspaceMetrics(db, {
      projectId: project.projectId,
      projectInternalId: project.projectInternalId,
      threadId: thread.threadId,
      threadInternalId: thread.threadInternalId,
      providers,
      startAt,
      endAt,
    });
    return sendJson(res, 200, payload);
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
  handleWorkspaceMetrics,
};
