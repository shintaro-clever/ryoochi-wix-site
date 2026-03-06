const { DEFAULT_TENANT } = require("../db");

const ALLOWED_BINDING_KEYS = ["ai", "github", "figma"];

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function projectExists(db, projectId) {
  return !!db
    .prepare("SELECT id FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
}

// --- Connections ---
function defaultConnections(projectId) {
  return {
    project_id: projectId,
    items: ALLOWED_BINDING_KEYS.map((key) => ({ key, enabled: false })),
  };
}

function getProjectConnections(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_bindings_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_bindings_json) return defaultConnections(projectId);
  try {
    const parsed = JSON.parse(row.project_bindings_json);
    if (!Array.isArray(parsed.items)) return defaultConnections(projectId);
    return { project_id: projectId, items: parsed.items };
  } catch {
    return defaultConnections(projectId);
  }
}

function putProjectConnections(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (!Array.isArray(body.items)) throw validationError("items must be an array");
  const seen = new Set();
  for (const item of body.items) {
    if (!item || typeof item !== "object") throw validationError("invalid item");
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!ALLOWED_BINDING_KEYS.includes(key)) throw validationError(`unknown key: ${key}`);
    if (seen.has(key)) throw validationError(`duplicate key: ${key}`);
    seen.add(key);
    if (typeof item.enabled !== "boolean") throw validationError("enabled must be boolean");
  }
  const now = new Date().toISOString();
  const data = { items: body.items.map(({ key, enabled }) => ({ key, enabled })) };
  db.prepare(
    "UPDATE projects SET project_bindings_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, items: data.items };
}

// --- Drive ---
function defaultDrive(projectId) {
  return { project_id: projectId, folder_id: "", folder_url: "", enabled: false };
}

function getProjectDrive(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_drive_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_drive_json) return defaultDrive(projectId);
  try {
    const parsed = JSON.parse(row.project_drive_json);
    return {
      project_id: projectId,
      folder_id: typeof parsed.folder_id === "string" ? parsed.folder_id : "",
      folder_url: typeof parsed.folder_url === "string" ? parsed.folder_url : "",
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
    };
  } catch {
    return defaultDrive(projectId);
  }
}

function putProjectDrive(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (body.folder_id !== undefined && typeof body.folder_id !== "string")
    throw validationError("folder_id must be string");
  if (body.folder_url !== undefined && typeof body.folder_url !== "string")
    throw validationError("folder_url must be string");
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    throw validationError("enabled must be boolean");

  const current = getProjectDrive(db, projectId) || defaultDrive(projectId);
  const data = {
    folder_id: typeof body.folder_id === "string" ? body.folder_id : current.folder_id,
    folder_url: typeof body.folder_url === "string" ? body.folder_url : current.folder_url,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE projects SET project_drive_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, ...data };
}

module.exports = { getProjectConnections, putProjectConnections, getProjectDrive, putProjectDrive };
