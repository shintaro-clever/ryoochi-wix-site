const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");

function nowIso() {
  return new Date().toISOString();
}

function parseConfig(configJson) {
  if (typeof configJson !== "string" || !configJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(configJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function listConnections(db, { tenantId = DEFAULT_TENANT, providerKey = "" } = {}) {
  const sql = providerKey
    ? "SELECT id,provider_key,config_json,created_at,updated_at FROM connections WHERE tenant_id=? AND provider_key=? ORDER BY created_at DESC"
    : "SELECT id,provider_key,config_json,created_at,updated_at FROM connections WHERE tenant_id=? ORDER BY created_at DESC";
  const rows = withRetry(() =>
    providerKey ? db.prepare(sql).all(tenantId, providerKey) : db.prepare(sql).all(tenantId)
  );
  return rows.map((row) => ({
    id: row.id,
    provider_key: row.provider_key || null,
    config_json: parseConfig(row.config_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function createConnection(
  db,
  { tenantId = DEFAULT_TENANT, providerKey, config = {}, id = crypto.randomUUID() } = {}
) {
  const ts = nowIso();
  const configJson = JSON.stringify(config || {});
  withRetry(() =>
    db
      .prepare(
        "INSERT INTO connections(tenant_id,id,provider,provider_key,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
      )
      .run(tenantId, id, providerKey, providerKey, configJson, ts, ts)
  );
  return {
    id,
    provider_key: providerKey,
    config_json: config,
    created_at: ts,
    updated_at: ts,
  };
}

function deleteConnection(db, { tenantId = DEFAULT_TENANT, id } = {}) {
  const info = withRetry(() =>
    db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(tenantId, id)
  );
  return info.changes > 0;
}

module.exports = {
  listConnections,
  createConnection,
  deleteConnection,
};
