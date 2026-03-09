"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const AUDIT_ACTIONS = require("../../src/audit/actions");
const { createThread } = require("../../src/server/threadsStore");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const actorId = `u-${crypto.randomUUID()}`;
  const createdProjectIds = [];
  const createdThreadIds = [];
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: actorId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "workspace-search-audit", staging_url: "https://example.com" }),
    });
    assert(projectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(projectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Audit Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    createdThreadIds.push(parsedThread.internalId);

    const beforeCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE tenant_id=? AND action=?")
      .get(DEFAULT_TENANT, AUDIT_ACTIONS.WORKSPACE_SEARCH).cnt;

    const searchRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/workspace/search",
      headers: authz,
      body: JSON.stringify({
        query: "confirm_token=abc123 env://secret/path github_pat_should_not_leak thread",
        scope: ["thread", "external_audit"],
        project_id: project.id,
        thread_id: thread.thread_id,
        provider_filter: ["github"],
        status_filter: ["failed"],
        limit: 5,
      }),
    });
    assert(searchRes.statusCode === 200, "search should return 200");

    const afterCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE tenant_id=? AND action=?")
      .get(DEFAULT_TENANT, AUDIT_ACTIONS.WORKSPACE_SEARCH).cnt;
    assert(afterCount >= beforeCount + 1, "workspace search should record audit log");

    const row = db
      .prepare("SELECT actor_id, meta_json, created_at FROM audit_logs WHERE tenant_id=? AND action=? ORDER BY created_at DESC LIMIT 1")
      .get(DEFAULT_TENANT, AUDIT_ACTIONS.WORKSPACE_SEARCH);
    assert(row, "workspace search audit row should exist");
    assert(row.actor_id === actorId, "audit actor_id should match requester");

    const meta = JSON.parse(row.meta_json);
    assert(meta && typeof meta === "object", "audit meta should be object");
    assert(meta.actor && meta.actor.id === actorId, "audit actor.id should match requester");
    assert(meta.requested_by === actorId, "requested_by should match requester");
    assert(meta.project_id === project.id, "project_id should be recorded");
    assert(meta.thread_id === thread.thread_id, "thread_id should be recorded");
    assert(Array.isArray(meta.scope) && meta.scope.includes("thread") && meta.scope.includes("external_audit"), "scope should be recorded");
    assert(Array.isArray(meta.provider_filter) && meta.provider_filter.includes("github"), "provider filter should be recorded");
    assert(Array.isArray(meta.status_filter) && meta.status_filter.includes("failed"), "status filter should be recorded");
    assert(typeof meta.result_count === "number", "result_count should be recorded");
    assert(typeof meta.recorded_at === "string" && meta.recorded_at.length > 0, "recorded_at should be recorded");
    assert(meta.query_summary && meta.query_summary.present === true, "query summary should indicate presence");
    assert(typeof meta.query_summary.preview === "string", "query summary preview should exist");
    assert(meta.query_summary.redacted === true, "query summary should mark redaction");
    assert(!meta.query_summary.preview.includes("confirm_token=abc123"), "query summary should redact confirm_token");
    assert(!meta.query_summary.preview.includes("env://secret/path"), "query summary should redact env secret");
    assert(!meta.query_summary.preview.includes("github_pat_should_not_leak"), "query summary should redact token-like text");
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
