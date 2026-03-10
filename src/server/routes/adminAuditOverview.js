const { sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { listOrganizations } = require("../organizationAdminStore");

const AUDIT_GROUPS = Object.freeze({
  org: [
    "org.member.create",
    "org.member.role_update",
    "org.invite.create",
    "org.invite.revoke",
    "org.role.upsert",
    "language.policy.update",
    "knowledge.source.policy.update",
  ],
  connection: [
    "connection.lifecycle.add",
    "connection.lifecycle.reauth",
    "connection.lifecycle.disable",
    "connection.lifecycle.delete",
    "connection.policy.update",
  ],
  ai: [
    "ai.requested",
    "ai.completed",
    "ai.failed",
    "summary.generated",
    "analysis.generated",
    "translation.generated",
  ],
  faq: [
    "faq.queried",
    "faq.answered",
    "faq.escalated",
    "faq.guardrail_applied",
  ],
});

const ALL_ACTIONS = Object.freeze(Array.from(new Set(Object.values(AUDIT_GROUPS).flat())));

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonSafe(text, fallback = {}) {
  if (typeof text !== "string" || !text.trim()) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function summarizeAuditMeta(meta = {}) {
  const source = meta && typeof meta === "object" ? meta : {};
  return {
    organization_id: normalizeText(source.organization_id) || null,
    member_id: normalizeText(source.member_id) || null,
    invite_id: normalizeText(source.invite_id) || null,
    role_id: normalizeText(source.role_id) || null,
    account_id: normalizeText(source.account_id) || null,
    email: normalizeText(source.email) || null,
    connection_id: normalizeText(source.connection_id) || null,
    provider_key: normalizeText(source.provider_key) || null,
    scope_type: normalizeText(source.scope_type) || null,
    scope_id: normalizeText(source.scope_id) || null,
    status: normalizeText(source.status) || null,
    use_case: normalizeText(source.use_case || source.summary_type || source.analysis_type || source.source_use_case) || null,
    target_language: normalizeText(source.target_language || source.language || source.default_language) || null,
    audience: normalizeText(source.audience) || null,
    failure_code: normalizeText(source.failure_code) || null,
    guardrail_code: normalizeText(source.guardrail_code) || null,
    run_id: normalizeText(source.run_id) || null,
    thread_id: normalizeText(source.thread_id) || null,
    project_id: normalizeText(source.project_id) || null,
  };
}

function resolveGroup(action) {
  return Object.entries(AUDIT_GROUPS).find(([, actions]) => actions.includes(action))?.[0] || "other";
}

function matchesFilters(row, filters) {
  if (!row) return false;
  if (filters.actionGroup !== "all" && row.group !== filters.actionGroup) return false;
  if (filters.actorId && normalizeText(row.actor_id) !== filters.actorId) return false;
  if (filters.projectId) {
    const meta = row.meta || {};
    if (normalizeText(meta.project_id) !== filters.projectId && !(meta.scope_type === "project" && normalizeText(meta.scope_id) === filters.projectId)) {
      return false;
    }
  }
  if (!filters.organizationId) return true;
  const meta = row.meta || {};
  const orgId = normalizeText(meta.organization_id);
  return orgId === filters.organizationId || (meta.scope_type === "organization" && normalizeText(meta.scope_id) === filters.organizationId);
}

function bucketTimeline(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const day = normalizeText(row.created_at).slice(0, 10) || "unknown";
    counts.set(day, (counts.get(day) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([day, count]) => ({ day, count }));
}

function countBy(rows, mapper) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = normalizeText(mapper(row)) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function listAuditRows(db, actorId = "") {
  const placeholders = ALL_ACTIONS.map(() => "?").join(",");
  const params = [DEFAULT_TENANT, ...ALL_ACTIONS];
  let sql =
    `SELECT actor_id, action, meta_json, created_at
       FROM audit_logs
      WHERE tenant_id=? AND action IN (${placeholders})`;
  if (actorId) {
    sql += " AND actor_id=?";
    params.push(actorId);
  }
  sql += " ORDER BY created_at DESC LIMIT 500";
  return db.prepare(sql).all(...params).map((row) => ({
    actor_id: normalizeText(row.actor_id) || null,
    action: row.action,
    group: resolveGroup(row.action),
    created_at: row.created_at,
    meta: summarizeAuditMeta(parseJsonSafe(row.meta_json)),
  }));
}

async function handleAdminAuditOverview(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  if (parsedUrl.pathname !== "/api/admin/audit-overview") return false;
  if (method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return true;
  }

  try {
    const filters = {
      actionGroup: normalizeText(parsedUrl.searchParams.get("action_group")) || "all",
      organizationId: normalizeText(parsedUrl.searchParams.get("organization_id")),
      projectId: normalizeText(parsedUrl.searchParams.get("project_id")),
      actorId: normalizeText(parsedUrl.searchParams.get("actor_id")),
      limit: Math.max(10, Math.min(100, Number(parsedUrl.searchParams.get("limit")) || 40)),
    };
    if (!["all", "org", "connection", "ai", "faq"].includes(filters.actionGroup)) {
      filters.actionGroup = "all";
    }

    const organizations = listOrganizations(db, DEFAULT_TENANT);
    const rows = listAuditRows(db, filters.actorId).filter((row) => matchesFilters(row, filters));
    return sendJson(res, 200, {
      generated_at: new Date().toISOString(),
      organizations,
      filters,
      tracked_groups: Object.keys(AUDIT_GROUPS),
      summary: {
        total_events: rows.length,
        org_events: rows.filter((row) => row.group === "org").length,
        connection_events: rows.filter((row) => row.group === "connection").length,
        ai_events: rows.filter((row) => row.group === "ai").length,
        faq_events: rows.filter((row) => row.group === "faq").length,
      },
      timeline: bucketTimeline(rows),
      breakdowns: {
        by_group: countBy(rows, (row) => row.group).map((row) => ({ group: row.key, count: row.count })),
        by_action: countBy(rows, (row) => row.action).map((row) => ({ action: row.key, count: row.count })),
        by_actor: countBy(rows, (row) => row.actor_id || "system").slice(0, 8).map((row) => ({ actor_id: row.key, count: row.count })),
        by_organization: countBy(
          rows,
          (row) => row.meta.organization_id || (row.meta.scope_type === "organization" ? row.meta.scope_id : "") || "workspace"
        ).slice(0, 8).map((row) => ({ organization_id: row.key, count: row.count })),
        connection_scope: countBy(rows.filter((row) => row.group === "connection"), (row) => row.meta.scope_type || "unknown").map((row) => ({ scope_type: row.key, count: row.count })),
      },
      recent_events: rows.slice(0, filters.limit),
    });
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      error.code || "SERVICE_UNAVAILABLE",
      error.message || "admin audit overview failed",
      error.details || { failure_code: error.failure_code || "service_unavailable" }
    );
  }
}

module.exports = {
  handleAdminAuditOverview,
};
