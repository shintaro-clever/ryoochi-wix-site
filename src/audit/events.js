const fs = require("fs");
const path = require("path");

const RUNS_DIR = path.join(process.cwd(), ".ai-runs");
const ALLOWED_TYPES = new Set(["LOGIN_SUCCESS", "RUN_CREATED", "RUN_STATUS_CHANGED"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const ip = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  return ip ? String(ip) : "unknown";
}

function actorFromReq(req, override = {}) {
  const user = req?.user || {};
  return {
    userId: override.userId || user.id || "unknown",
    role: override.role || user.role || "unknown",
  };
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const safe = {};
  Object.keys(meta).forEach((key) => {
    const value = meta[key];
    if (/token|secret|password|api[_-]?key/i.test(key)) {
      const has = typeof value === "string" ? value.length > 0 : Boolean(value);
      const len = typeof value === "string" ? value.length : 0;
      safe[key] = { has_secret: has, secret_len: len };
      return;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[key] = value;
      return;
    }
    safe[key] = String(value);
  });
  return safe;
}

function ensureRunAuditPath(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  return path.join(runDir, "audit.jsonl");
}

function emitAuditWriteFailed(runId, error) {
  const payload = {
    ts: nowIso(),
    type: "AUDIT_WRITE_FAILED",
    run_id: runId ? String(runId) : undefined,
    reason: error && error.message ? String(error.message) : "unknown",
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function buildEvent({ req, type, runId = null, actor = {}, meta = {} }) {
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`unsupported audit type: ${type}`);
  }
  const event = {
    ts: nowIso(),
    type,
    actor: actorFromReq(req, actor),
    ip: normalizeIp(req),
    meta: sanitizeMeta(meta),
  };
  if (runId) {
    event.run_id = String(runId);
  }
  return event;
}

function emitAuditEvent({ req, type, runId = null, actor = {}, meta = {} }) {
  const event = buildEvent({ req, type, runId, actor, meta });
  const line = `${JSON.stringify(event)}\n`;
  if (event.run_id) {
    try {
      const target = ensureRunAuditPath(event.run_id);
      fs.appendFileSync(target, line);
    } catch (error) {
      emitAuditWriteFailed(event.run_id, error);
      throw error;
    }
    return;
  }
  process.stdout.write(line);
}

module.exports = {
  emitAuditEvent,
  buildEvent,
};
