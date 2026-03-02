const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { listConnections, createConnection, deleteConnection } = require("../../connectors/store");
const { normalizeFigmaConfig } = require("../../connectors/figma");
const { normalizeGithubConfig, verifyGithubToken } = require("../../connectors/github");

function parseProviderKey(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key;
}

function normalizeConnectionPayload(providerKey, body = {}) {
  const raw = body && typeof body.config_json === "object" && body.config_json !== null ? body.config_json : {};
  if (providerKey === "figma") {
    return normalizeFigmaConfig(raw);
  }
  if (providerKey === "github") {
    return normalizeGithubConfig(raw);
  }
  const error = new Error("provider_key is not supported");
  error.status = 400;
  error.failure_code = "validation_error";
  throw error;
}

async function handleConnectorConnections(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const path = parsedUrl.pathname;

  if (method === "GET" && path === "/api/connectors/connections") {
    const providerKey = parseProviderKey(parsedUrl.searchParams.get("provider_key"));
    return sendJson(res, 200, listConnections(db, { providerKey }));
  }

  if (method === "POST" && path === "/api/connectors/connections") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
    }
    const providerKey = parseProviderKey(body && body.provider_key);
    if (!providerKey) {
      return jsonError(res, 400, "VALIDATION_ERROR", "provider_key is required", {
        failure_code: "validation_error",
      });
    }
    try {
      const config = normalizeConnectionPayload(providerKey, body);
      if (providerKey === "github") {
        await verifyGithubToken(config.github_token);
      }
      const created = createConnection(db, {
        providerKey,
        config,
      });
      return sendJson(res, 201, created);
    } catch (error) {
      return jsonError(
        res,
        error.status || 500,
        "VALIDATION_ERROR",
        error.message || "connector create failed",
        {
          failure_code: error.failure_code || "service_unavailable",
        }
      );
    }
  }

  const deleteMatch = path.match(/^\/api\/connectors\/connections\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const id = deleteMatch[1];
    const ok = deleteConnection(db, { id });
    if (!ok) {
      return jsonError(res, 404, "NOT_FOUND", "connection not found", {
        failure_code: "not_found",
      });
    }
    res.writeHead(204);
    return res.end();
  }

  return false;
}

module.exports = {
  handleConnectorConnections,
};
