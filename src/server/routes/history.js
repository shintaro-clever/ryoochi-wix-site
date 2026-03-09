"use strict";

const { Buffer } = require("buffer");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { parseProjectIdInput } = require("../projectsStore");
const { parseThreadIdInput } = require("../threadsStore");
const { parseRunIdInput } = require("../../api/runs");
const { listHistory, summarizeHistoryPage } = require("../../db/history");

const ALLOWED_EVENT_TYPES = Object.freeze([
  "run.created",
  "run.status_changed",
  "read.plan_recorded",
  "write.plan_recorded",
  "confirm.executed",
  "external_operation.recorded",
  "audit.projected",
  "chat.message_recorded",
]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validationDetails(reason, extra = {}) {
  return { failure_code: "validation_error", reason, ...extra };
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

function parseEventTypes(value) {
  const out = normalizeList(value);
  out.forEach((item) => {
    if (!ALLOWED_EVENT_TYPES.includes(item)) {
      throw {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "event_type is invalid",
        details: validationDetails("invalid_event_type", { event_type: item }),
      };
    }
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

async function handleHistory(req, res, db) {
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
          run_id: url.searchParams.get("run_id"),
          event_type:
            url.searchParams.getAll("event_type").length > 1
              ? url.searchParams.getAll("event_type")
              : url.searchParams.get("event_type") || url.searchParams.get("event_types"),
          provider:
            url.searchParams.getAll("provider").length > 1
              ? url.searchParams.getAll("provider")
              : url.searchParams.get("provider") || url.searchParams.get("provider_filter"),
          status:
            url.searchParams.getAll("status").length > 1
              ? url.searchParams.getAll("status")
              : url.searchParams.get("status") || url.searchParams.get("status_filter"),
          start_at: url.searchParams.get("start_at") || url.searchParams.get("recorded_from"),
          end_at: url.searchParams.get("end_at") || url.searchParams.get("recorded_to"),
          limit: url.searchParams.get("limit"),
          cursor: url.searchParams.get("cursor"),
        }
      : body || {};

  try {
    const project = parseProjectFilter(source.project_id);
    const thread = parseThreadFilter(source.thread_id);
    const run = parseRunFilter(source.run_id);
    const limit = parseLimit(source.limit);
    const offset = parseCursor(source.cursor);
    const startAt = parseDateInput(source.start_at || source.recorded_from, "start_at");
    const endAt = parseDateInput(source.end_at || source.recorded_to, "end_at");
    const eventTypes = parseEventTypes(source.event_type || source.event_types);
    const providers = normalizeList(source.provider || source.provider_filter);
    const statuses = normalizeList(source.status || source.status_filter);

    const items = listHistory(db, {
      projectInternalId: project.projectInternalId,
      threadInternalId: thread.threadInternalId,
      runInternalId: run.runInternalId,
      startAt,
      endAt,
      eventTypes,
      providers,
      statuses,
    });

    const paged = items.slice(offset, offset + limit);
    const nextCursor = offset + limit < items.length ? encodeCursor(offset + limit) : null;
    const summaries = summarizeHistoryPage(paged);
    return sendJson(res, 200, {
      project_id: project.projectId,
      thread_id: thread.threadId,
      run_id: run.runId,
      event_type: eventTypes,
      provider: providers,
      status: statuses,
      start_at: startAt || null,
      end_at: endAt || null,
      limit,
      next_cursor: nextCursor,
      day_groups: summaries.day_groups,
      run_summaries: summaries.run_summaries,
      items: paged,
    });
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
  handleHistory,
};
