const http = require("http");
const fs = require("fs");
const path = require("path");
const { initDB } = require("../db");
const {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
} = require("../api/projects");
const { listRuns, createRun } = require("../api/runs");
const { handleProjectRunsPost } = require("../routes/runs");
const { handleAuthLogin } = require("../routes/auth");
const { handleArtifactsPost, handleArtifactsGet } = require("../routes/artifacts");
const { requireAuth } = require("../middleware/auth");
const { logRequest } = require("../middleware/requestLog");

const ROOT_DIR = path.join(__dirname, "..", "..");
const connectionsDataPath = path.join(ROOT_DIR, "apps", "hub", "data", "connections.json");
const connectorsCatalogPath = path.join(ROOT_DIR, "apps", "hub", "data", "connectors.catalog.json");

function isServiceUnavailableError(error) {
  return Boolean(error && error.status === 503 && error.failure_code === "service_unavailable");
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function tokenNote(label, value) {
  if (!hasValue(value)) return `${label}: missing`;
  return `${label}: present len=${String(value).length}`;
}

function createEmptyConnections() {
  return {
    ai: { provider: "", name: "", apiKey: "" },
    github: { repo: "", token: "" },
    figma: { fileUrl: "", token: "" },
  };
}

function readConnections() {
  if (!fs.existsSync(connectionsDataPath)) {
    return createEmptyConnections();
  }
  try {
    const raw = fs.readFileSync(connectionsDataPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ai: {
        provider: typeof parsed.ai?.provider === "string" ? parsed.ai.provider.trim() : "",
        name: typeof parsed.ai?.name === "string" ? parsed.ai.name.trim() : "",
        apiKey: typeof parsed.ai?.apiKey === "string" ? parsed.ai.apiKey.trim() : "",
      },
      github: {
        repo: typeof parsed.github?.repo === "string" ? parsed.github.repo.trim() : "",
        token: typeof parsed.github?.token === "string" ? parsed.github.token.trim() : "",
      },
      figma: {
        fileUrl: typeof parsed.figma?.fileUrl === "string" ? parsed.figma.fileUrl.trim() : "",
        token: typeof parsed.figma?.token === "string" ? parsed.figma.token.trim() : "",
      },
    };
  } catch {
    return createEmptyConnections();
  }
}

function getConnectionsUpdatedAt() {
  if (!fs.existsSync(connectionsDataPath)) return null;
  try {
    return fs.statSync(connectionsDataPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readConnectorsCatalog() {
  if (!fs.existsSync(connectorsCatalogPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(connectorsCatalogPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isConnected(providerKey, connections) {
  if (providerKey === "ai") return hasValue(connections.ai?.apiKey);
  if (providerKey === "github") return hasValue(connections.github?.token);
  if (providerKey === "figma") return hasValue(connections.figma?.token);
  return false;
}

function buildConnectionItems(connections, updatedAt) {
  return [
    {
      id: "conn-ai",
      key: "ai",
      name: "AI Provider",
      enabled: hasValue(connections.ai?.provider) || hasValue(connections.ai?.name) || hasValue(connections.ai?.apiKey),
      connected: hasValue(connections.ai?.apiKey),
      last_checked_at: updatedAt,
      notes: [tokenNote("api_key", connections.ai?.apiKey), `provider=${connections.ai?.provider || "(none)"}`],
    },
    {
      id: "conn-github",
      key: "github",
      name: "GitHub",
      enabled: hasValue(connections.github?.repo) || hasValue(connections.github?.token),
      connected: hasValue(connections.github?.token),
      last_checked_at: updatedAt,
      notes: [tokenNote("token", connections.github?.token), `repo=${connections.github?.repo || "(none)"}`],
    },
    {
      id: "conn-figma",
      key: "figma",
      name: "Figma",
      enabled: hasValue(connections.figma?.fileUrl) || hasValue(connections.figma?.token),
      connected: hasValue(connections.figma?.token),
      last_checked_at: updatedAt,
      notes: [tokenNote("token", connections.figma?.token), `file_url=${connections.figma?.fileUrl || "(none)"}`],
    },
  ];
}

function createApiServer(dbConn) {
  const db =
    dbConn && dbConn.constructor && dbConn.constructor.name === "Database"
      ? dbConn
      : initDB();

  return http.createServer(async (req, res) => {
    const urlPath = (req.url || "").split("?")[0] || "/";
    const method = (req.method || "GET").toUpperCase();
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      logRequest({
        req,
        res,
        body: req._logBody,
        durationMs: elapsedMs,
      });
    });

    try {
      if (urlPath.startsWith("/api/") && !urlPath.startsWith("/api/auth/")) {
        const ok = requireAuth(req, res);
        if (!ok) {
          return;
        }
      }

      if (method === "GET" && urlPath === "/healthz") {
        return sendJson(res, 200, { status: "ok" });
      }

      if (urlPath === "/api/connectors") {
        if (method !== "GET") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        const connections = readConnections();
        const updatedAt = getConnectionsUpdatedAt();
        const rows = readConnectorsCatalog().map((item) => ({
          ...item,
          key: item.provider_key,
          enabled: true,
          connected: isConnected(item.provider_key, connections),
          last_checked_at: updatedAt,
          notes: [tokenNote("credentials", item.provider_key === "ai"
            ? connections.ai?.apiKey
            : item.provider_key === "github"
              ? connections.github?.token
              : item.provider_key === "figma"
                ? connections.figma?.token
                : "")],
        }));
        return sendJson(res, 200, rows);
      }

      if (urlPath === "/api/connections") {
        if (method !== "GET") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        const connections = readConnections();
        const updatedAt = getConnectionsUpdatedAt();
        return sendJson(res, 200, {
          ai: {
            provider: connections.ai?.provider || "",
            name: connections.ai?.name || "",
            apiKey: "",
          },
          github: {
            repo: connections.github?.repo || "",
            token: "",
          },
          figma: {
            fileUrl: connections.figma?.fileUrl || "",
            token: "",
          },
          items: buildConnectionItems(connections, updatedAt),
          updated_at: updatedAt,
        });
      }

      // GET/HEAD /api/projects
      if ((method === "GET" || method === "HEAD") && urlPath === "/api/projects") {
        if (method === "HEAD") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          return res.end();
        }
        return sendJson(res, 200, listProjects(db));
      }

      // POST /api/projects
      if (method === "POST" && urlPath === "/api/projects") {
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
        }

        const nameErr = validateName(body.name);
        const urlErr = validateHttpsUrl(body.staging_url);
        if (nameErr || urlErr) {
          return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { nameErr, urlErr });
        }

        const created = createProject(db, body.name.trim(), body.staging_url.trim(), req.user?.id);
        return sendJson(res, 201, created);
      }

      // GET/POST /api/runs
      if (urlPath === "/api/runs") {
        if (method === "GET") {
          return sendJson(res, 200, listRuns(db));
        }
        if (method === "POST") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
          }
          const jobType = typeof body.job_type === "string" ? body.job_type.trim() : "";
          const targetPath = typeof body.target_path === "string" ? body.target_path.trim() : "";
          if (!jobType || !targetPath) {
            return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です");
          }
          const inputs =
            body && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {};
          const runId = createRun(db, { job_type: jobType, inputs, target_path: targetPath });
          return sendJson(res, 201, { run_id: runId, status: "queued" });
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      // /api/projects/:id
      const runMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/runs$/);
      if (runMatch) {
        const id = runMatch[1];
        if (method === "POST") {
          return await handleProjectRunsPost(req, res, db, id);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/artifacts") {
        if (method === "POST") {
          return await handleArtifactsPost(req, res);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/auth/login") {
        return await handleAuthLogin(req, res, db);
      }

      const artifactMatch = urlPath.match(/^\/api\/artifacts\/([^/]+)$/);
      if (artifactMatch) {
        const name = artifactMatch[1];
        if (method === "GET") {
          return handleArtifactsGet(req, res, name);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const m = urlPath.match(/^\/api\/projects\/([^/]+)$/);
      if (m) {
        const id = m[1];

        if (method === "GET") {
          const item = getProject(db, id);
          if (!item) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          return sendJson(res, 200, item);
        }

        if (method === "PATCH") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
          }

          if (body.name !== undefined) {
            const e = validateName(body.name);
            if (e) return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { nameErr: e });
          }
          if (body.staging_url !== undefined) {
            const e = validateHttpsUrl(body.staging_url);
            if (e) return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { urlErr: e });
          }

          const updated = patchProject(db, id, body, req.user?.id);
          if (!updated) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          return sendJson(res, 200, updated);
        }

        if (method === "DELETE") {
          // 将来: runs(queued/running)があれば409で止める枠。現状は常に削除可。
          const ok = deleteProject(db, id, req.user?.id);
          if (!ok) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          res.writeHead(204);
          return res.end();
        }
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (error) {
      if (res.headersSent) {
        return;
      }
      if (isServiceUnavailableError(error)) {
        return jsonError(res, 503, "SERVICE_UNAVAILABLE", "service unavailable", {
          failure_code: "service_unavailable",
        });
      }
      throw error;
    }
  });
}

module.exports = { createApiServer };
