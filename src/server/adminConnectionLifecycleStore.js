const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db");
const { validateSecretReference } = require("../api/projects");
const { decrypt, encrypt } = require("../crypto/secrets");
const { requireOrganization } = require("./organizationAdminStore");

const SUPPORTED_SCOPES = Object.freeze(["account", "project", "organization"]);
const SUPPORTED_STATUSES = Object.freeze(["active", "reauth_required", "disabled"]);
const SUPPORTED_PROVIDERS = Object.freeze(["openai", "github", "figma"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function parseJsonObject(text, fallback = {}) {
  if (typeof text !== "string" || !text.trim()) return fallback;
  let raw = text;
  try {
    raw = decrypt(text);
  } catch {}
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function validationError(message, details = {}) {
  return {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details: { failure_code: "validation_error", ...details },
  };
}

function notFoundError(message = "connection not found") {
  return {
    status: 404,
    code: "NOT_FOUND",
    message,
    details: { failure_code: "not_found" },
  };
}

function ensureProjectExists(db, projectId) {
  const id = normalizeText(projectId);
  const row = db.prepare("SELECT id FROM projects WHERE tenant_id=? AND id=? LIMIT 1").get(DEFAULT_TENANT, id);
  if (!row) throw validationError("project scope_id is invalid", { field: "scope_id" });
  return id;
}

function validateScope(db, scopeType, scopeId) {
  const type = normalizeText(scopeType).toLowerCase();
  const id = normalizeText(scopeId);
  if (!SUPPORTED_SCOPES.includes(type)) {
    throw validationError("scope_type is invalid", { field: "scope_type" });
  }
  if (!id) {
    throw validationError("scope_id is required", { field: "scope_id" });
  }
  if (type === "organization") {
    requireOrganization(db, id, DEFAULT_TENANT);
  } else if (type === "project") {
    ensureProjectExists(db, id);
  }
  return { scope_type: type, scope_id: id };
}

function validateProviderKey(value) {
  const provider = normalizeText(value).toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw validationError("provider_key is invalid", { field: "provider_key" });
  }
  return provider;
}

function sanitizeConfig(providerKey, config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw validationError("config must be object", { field: "config" });
  }
  const provider = validateProviderKey(providerKey);
  if (provider === "openai") {
    return {
      model: normalizeText(config.model),
      name: normalizeText(config.name),
      use_cases: Array.isArray(config.use_cases) ? config.use_cases.map((item) => normalizeText(item)).filter(Boolean) : [],
    };
  }
  if (provider === "github") {
    return {
      repository: normalizeText(config.repository),
      installation_ref: normalizeText(config.installation_ref),
      writable_scope: normalizeText(config.writable_scope),
    };
  }
  return {
    file_key: normalizeText(config.file_key),
    file_url: normalizeText(config.file_url),
    page_scope: normalizeText(config.page_scope),
  };
}

function sanitizePolicy(policy = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw validationError("policy must be object", { field: "policy" });
  }
  return {
    allowed_use_cases: Array.isArray(policy.allowed_use_cases)
      ? policy.allowed_use_cases.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    allowed_projects: Array.isArray(policy.allowed_projects)
      ? policy.allowed_projects.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    auto_disable_on_failure: Boolean(policy.auto_disable_on_failure),
    reauth_interval_days: Number.isFinite(Number(policy.reauth_interval_days))
      ? Math.max(0, Number(policy.reauth_interval_days))
      : 0,
  };
}

function sanitizeSecretRef(secretRef) {
  const text = normalizeText(secretRef);
  if (!text) return null;
  const error = validateSecretReference(text, "secret_ref");
  if (error) {
    throw validationError(error, { field: "secret_ref" });
  }
  return text;
}

function mapConnectionRow(row) {
  return {
    connection_id: row.id,
    provider_key: normalizeOptionalText(row.provider_key),
    scope_type: normalizeOptionalText(row.scope_type),
    scope_id: normalizeOptionalText(row.scope_id),
    status: normalizeText(row.status || "active") || "active",
    secret_ref: normalizeOptionalText(row.secret_ref),
    disabled_at: normalizeOptionalText(row.disabled_at),
    created_by: normalizeOptionalText(row.created_by),
    updated_by: normalizeOptionalText(row.updated_by),
    config: parseJsonObject(row.config_json, {}),
    policy: parseJsonObject(row.policy_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getConnection(db, connectionId, tenantId = DEFAULT_TENANT) {
  const id = normalizeText(connectionId);
  if (!id) throw validationError("connection_id is required", { field: "connection_id" });
  const row = db
    .prepare(
      `SELECT id, provider_key, scope_type, scope_id, status, secret_ref, disabled_at, created_by, updated_by, config_json, policy_json, created_at, updated_at
       FROM connections WHERE tenant_id=? AND id=? LIMIT 1`
    )
    .get(tenantId, id);
  if (!row) throw notFoundError();
  return mapConnectionRow(row);
}

function listLifecycleConnections(db, filters = {}, tenantId = DEFAULT_TENANT) {
  const where = ["tenant_id=?"];
  const params = [tenantId];
  const scopeType = normalizeText(filters.scope_type).toLowerCase();
  const scopeId = normalizeText(filters.scope_id);
  const providerKey = normalizeText(filters.provider_key).toLowerCase();
  if (scopeType) {
    if (!SUPPORTED_SCOPES.includes(scopeType)) throw validationError("scope_type is invalid", { field: "scope_type" });
    where.push("scope_type=?");
    params.push(scopeType);
  }
  if (scopeId) {
    where.push("scope_id=?");
    params.push(scopeId);
  }
  if (providerKey) {
    where.push("provider_key=?");
    params.push(providerKey);
  }
  const rows = db
    .prepare(
      `SELECT id, provider_key, scope_type, scope_id, status, secret_ref, disabled_at, created_by, updated_by, config_json, policy_json, created_at, updated_at
       FROM connections
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(...params);
  return rows.map(mapConnectionRow);
}

function addLifecycleConnection(db, payload = {}, { actorId = "", tenantId = DEFAULT_TENANT } = {}) {
  const scope = validateScope(db, payload.scope_type, payload.scope_id);
  const providerKey = validateProviderKey(payload.provider_key);
  const config = sanitizeConfig(providerKey, payload.config || {});
  const policy = sanitizePolicy(payload.policy || {});
  const secretRef = sanitizeSecretRef(payload.secret_ref);
  const ts = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO connections(
      tenant_id,id,provider,provider_key,config_json,scope_type,scope_id,status,secret_ref,policy_json,disabled_at,created_by,updated_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    tenantId,
    id,
    providerKey,
    providerKey,
    encrypt(JSON.stringify(config)),
    scope.scope_type,
    scope.scope_id,
    "active",
    secretRef,
    JSON.stringify(policy),
    null,
    normalizeOptionalText(actorId),
    normalizeOptionalText(actorId),
    ts,
    ts
  );
  return getConnection(db, id, tenantId);
}

function reauthLifecycleConnection(db, connectionId, payload = {}, { actorId = "", tenantId = DEFAULT_TENANT } = {}) {
  const current = getConnection(db, connectionId, tenantId);
  const secretRef = payload.secret_ref === undefined ? current.secret_ref : sanitizeSecretRef(payload.secret_ref);
  const policy = payload.policy === undefined ? current.policy : sanitizePolicy(payload.policy);
  const config = payload.config === undefined ? current.config : sanitizeConfig(current.provider_key, payload.config);
  const ts = nowIso();
  db.prepare(
    `UPDATE connections
     SET secret_ref=?, policy_json=?, config_json=?, status='active', disabled_at=NULL, updated_by=?, updated_at=?
     WHERE tenant_id=? AND id=?`
  ).run(
    secretRef,
    JSON.stringify(policy),
    encrypt(JSON.stringify(config)),
    normalizeOptionalText(actorId),
    ts,
    tenantId,
    current.connection_id
  );
  return getConnection(db, current.connection_id, tenantId);
}

function disableLifecycleConnection(db, connectionId, { actorId = "", tenantId = DEFAULT_TENANT } = {}) {
  const current = getConnection(db, connectionId, tenantId);
  const ts = nowIso();
  db.prepare(
    `UPDATE connections
     SET status='disabled', disabled_at=?, updated_by=?, updated_at=?
     WHERE tenant_id=? AND id=?`
  ).run(ts, normalizeOptionalText(actorId), ts, tenantId, current.connection_id);
  return getConnection(db, current.connection_id, tenantId);
}

function updateConnectionPolicy(db, connectionId, policy = {}, { actorId = "", tenantId = DEFAULT_TENANT } = {}) {
  const current = getConnection(db, connectionId, tenantId);
  const nextPolicy = sanitizePolicy(policy);
  const ts = nowIso();
  db.prepare(
    `UPDATE connections
     SET policy_json=?, updated_by=?, updated_at=?
     WHERE tenant_id=? AND id=?`
  ).run(JSON.stringify(nextPolicy), normalizeOptionalText(actorId), ts, tenantId, current.connection_id);
  return getConnection(db, current.connection_id, tenantId);
}

function deleteLifecycleConnection(db, connectionId, tenantId = DEFAULT_TENANT) {
  const current = getConnection(db, connectionId, tenantId);
  const info = db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(tenantId, current.connection_id);
  if (info.changes < 1) throw notFoundError();
  return current;
}

module.exports = {
  SUPPORTED_PROVIDERS,
  SUPPORTED_SCOPES,
  addLifecycleConnection,
  deleteLifecycleConnection,
  disableLifecycleConnection,
  getConnection,
  listLifecycleConnections,
  reauthLifecycleConnection,
  updateConnectionPolicy,
};
