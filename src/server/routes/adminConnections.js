const { DEFAULT_TENANT } = require("../../db");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");
const {
  addLifecycleConnection,
  deleteLifecycleConnection,
  disableLifecycleConnection,
  getConnection,
  listLifecycleConnections,
  reauthLifecycleConnection,
  updateConnectionPolicy,
} = require("../adminConnectionLifecycleStore");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readBody(req, res) {
  try {
    return await readJsonBody(req);
  } catch {
    jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    return null;
  }
}

function writeAdminConnectionAudit(db, action, actorId, connection, meta = {}) {
  recordAudit({
    db,
    tenantId: DEFAULT_TENANT,
    actorId: normalizeText(actorId) || null,
    action,
    meta: {
      connection_id: connection.connection_id,
      provider_key: connection.provider_key,
      scope_type: connection.scope_type,
      scope_id: connection.scope_id,
      status: connection.status,
      ...meta,
    },
  });
}

async function handleAdminConnections(req, res, db, { userId = "" } = {}) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const path = parsedUrl.pathname;

  if (path === "/api/admin/connections") {
    if (method === "GET") {
      const items = listLifecycleConnections(
        db,
        {
          scope_type: parsedUrl.searchParams.get("scope_type"),
          scope_id: parsedUrl.searchParams.get("scope_id"),
          provider_key: parsedUrl.searchParams.get("provider_key"),
        },
        DEFAULT_TENANT
      );
      return sendJson(res, 200, { items });
    }
    if (method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return true;
      try {
        const item = addLifecycleConnection(db, body, { actorId: userId, tenantId: DEFAULT_TENANT });
        writeAdminConnectionAudit(db, AUDIT_ACTIONS.CONNECTION_LIFECYCLE_ADD, userId, item);
        return sendJson(res, 201, item);
      } catch (error) {
        return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "invalid input", error.details);
      }
    }
  }

  const actionMatch = path.match(/^\/api\/admin\/connections\/([^/]+)(?:\/(reauth|disable|policy))?$/);
  if (!actionMatch) {
    return false;
  }
  const connectionId = normalizeText(actionMatch[1]);
  const action = normalizeText(actionMatch[2]);

  if (!action && method === "DELETE") {
    try {
      const item = deleteLifecycleConnection(db, connectionId, DEFAULT_TENANT);
      writeAdminConnectionAudit(db, AUDIT_ACTIONS.CONNECTION_LIFECYCLE_DELETE, userId, item);
      res.writeHead(204);
      res.end();
      return true;
    } catch (error) {
      return jsonError(res, error.status || 404, error.code || "NOT_FOUND", error.message || "connection not found", error.details);
    }
  }

  if (!action && method === "GET") {
    try {
      return sendJson(res, 200, getConnection(db, connectionId, DEFAULT_TENANT));
    } catch (error) {
      return jsonError(res, error.status || 404, error.code || "NOT_FOUND", error.message || "connection not found", error.details);
    }
  }

  const body = ["POST", "PUT"].includes(method) ? await readBody(req, res) : {};
  if (["POST", "PUT"].includes(method) && body === null) return true;

  try {
    if (method === "POST" && action === "reauth") {
      const item = reauthLifecycleConnection(db, connectionId, body, { actorId: userId, tenantId: DEFAULT_TENANT });
      writeAdminConnectionAudit(db, AUDIT_ACTIONS.CONNECTION_LIFECYCLE_REAUTH, userId, item);
      return sendJson(res, 200, item);
    }
    if (method === "POST" && action === "disable") {
      const item = disableLifecycleConnection(db, connectionId, { actorId: userId, tenantId: DEFAULT_TENANT });
      writeAdminConnectionAudit(db, AUDIT_ACTIONS.CONNECTION_LIFECYCLE_DISABLE, userId, item);
      return sendJson(res, 200, item);
    }
    if ((method === "GET" || method === "PUT") && action === "policy") {
      if (method === "GET") {
        const item = getConnection(db, connectionId, DEFAULT_TENANT);
        return sendJson(res, 200, {
          connection_id: item.connection_id,
          provider_key: item.provider_key,
          scope_type: item.scope_type,
          scope_id: item.scope_id,
          policy: item.policy,
        });
      }
      const item = updateConnectionPolicy(db, connectionId, body.policy || body, { actorId: userId, tenantId: DEFAULT_TENANT });
      writeAdminConnectionAudit(db, AUDIT_ACTIONS.CONNECTION_POLICY_UPDATE, userId, item, {
        policy: item.policy,
      });
      return sendJson(res, 200, {
        connection_id: item.connection_id,
        provider_key: item.provider_key,
        scope_type: item.scope_type,
        scope_id: item.scope_id,
        policy: item.policy,
      });
    }
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return true;
  } catch (error) {
    return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "invalid input", error.details);
  }
}

module.exports = {
  handleAdminConnections,
};
