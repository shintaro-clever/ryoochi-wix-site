const { DEFAULT_TENANT } = require("../db/sqlite");
const crypto = require("crypto");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { withRetry } = require("../db/retry");
const { buildErrorBody } = require("../server/errors");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(res, status, code, message, details) {
  sendJson(
    res,
    status,
    buildErrorBody({
      code,
      message,
      details: details || {},
    })
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        req._logBody = parsed;
        resolve(parsed);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function validateHttpsUrl(url) {
  if (typeof url !== "string" || url.trim().length === 0) return "staging_url is required";
  if (url.length > 2048) return "staging_url too long";
  if (!/^https:\/\//i.test(url)) return "staging_url must start with https://";
  return null;
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length === 0) return "name is required";
  if (name.length > 200) return "name too long";
  return null;
}

function normalizeDriveFolderId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const urlMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  const queryMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1];
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) {
    return text;
  }
  return "";
}

function validateDriveFolderId(value, { required = false } = {}) {
  const normalized = normalizeDriveFolderId(value);
  if (!normalized) {
    return required ? "drive_folder_id is required" : null;
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(normalized)) {
    return "drive_folder_id is invalid";
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function listProjects(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,created_at,updated_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
  );
}

function getProject(db, id) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,created_at,updated_at FROM projects WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, id)
  );
}

function createProject(db, name, stagingUrl, actorId, options = {}) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const description = typeof options.description === "string" ? options.description.trim() : "";
  const driveFolderId = normalizeDriveFolderId(options.drive_folder_id);
  withRetry(() =>
    db.prepare(
      "INSERT INTO projects(tenant_id,id,name,description,staging_url,drive_folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
    ).run(DEFAULT_TENANT, id, name, description, stagingUrl, driveFolderId || null, ts, ts)
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_CREATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function patchProject(db, id, patch, actorId) {
  const existing = getProject(db, id);
  if (!existing) return null;

  const nextName = typeof patch.name === "string" ? patch.name : existing.name;
  const nextUrl = typeof patch.staging_url === "string" ? patch.staging_url : existing.staging_url;
  const nextDescription =
    typeof patch.description === "string" ? patch.description : existing.description || "";
  const nextDriveFolderId =
    patch.drive_folder_id !== undefined
      ? normalizeDriveFolderId(patch.drive_folder_id) || null
      : existing.drive_folder_id || null;

  withRetry(() =>
    db
      .prepare(
        "UPDATE projects SET name=?, description=?, staging_url=?, drive_folder_id=?, updated_at=? WHERE tenant_id=? AND id=?"
      )
      .run(nextName, nextDescription, nextUrl, nextDriveFolderId, nowIso(), DEFAULT_TENANT, id)
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_UPDATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function deleteProject(db, id, actorId) {
  const info = withRetry(() =>
    db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id)
  );
  if (info.changes > 0) {
    recordAudit({
      db,
      action: AUDIT_ACTIONS.PROJECT_DELETE,
      tenantId: DEFAULT_TENANT,
      actorId,
      meta: { project_id: id },
    });
  }
  return info.changes > 0;
}

module.exports = {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  validateDriveFolderId,
  normalizeDriveFolderId,
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
};
