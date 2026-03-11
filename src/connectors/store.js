const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");
const { openDb } = require("../db");
const { encrypt, decrypt } = require("../crypto/secrets");

function nowIso() {
  return new Date().toISOString();
}

function parseConfig(configJson) {
  if (typeof configJson !== "string" || !configJson.trim()) {
    return {};
  }
  let jsonText = configJson;
  try {
    jsonText = decrypt(configJson);
  } catch {
    jsonText = configJson;
  }
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function withConnectorDb(db, fn) {
  try {
    return fn(db);
  } catch (error) {
    if (!error || error.code !== "SQLITE_CANTOPEN") throw error;
    const fallbackDb = openDb();
    return fn(fallbackDb);
  }
}

function listConnections(db, { tenantId = DEFAULT_TENANT, providerKey = "" } = {}) {
  const sql = providerKey
    ? "SELECT id,provider_key,config_json,created_at,updated_at FROM connections WHERE tenant_id=? AND provider_key=? ORDER BY created_at DESC"
    : "SELECT id,provider_key,config_json,created_at,updated_at FROM connections WHERE tenant_id=? ORDER BY created_at DESC";
  const rows = withConnectorDb(db, (activeDb) =>
    withRetry(() => (providerKey ? activeDb.prepare(sql).all(tenantId, providerKey) : activeDb.prepare(sql).all(tenantId)))
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
  const configJson = encrypt(JSON.stringify(config || {}));
  withConnectorDb(db, (activeDb) =>
    withRetry(() =>
      activeDb
        .prepare(
          "INSERT INTO connections(tenant_id,id,provider,provider_key,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
        )
        .run(tenantId, id, providerKey, providerKey, configJson, ts, ts)
    )
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
  const info = withConnectorDb(db, (activeDb) =>
    withRetry(() => activeDb.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(tenantId, id))
  );
  return info.changes > 0;
}

module.exports = {
  listConnections,
  createConnection,
  deleteConnection,
};
