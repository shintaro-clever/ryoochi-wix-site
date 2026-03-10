const { sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { listWorkspaceMetrics } = require("../../db/workspaceMetrics");

const AI_AUDIT_ACTIONS = Object.freeze([
  "ai.requested",
  "ai.completed",
  "ai.failed",
  "summary.generated",
  "analysis.generated",
  "translation.generated",
  "faq.queried",
  "faq.answered",
  "faq.escalated",
  "faq.guardrail_applied",
]);

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
    provider: normalizeText(source.provider) || null,
    use_case: normalizeText(source.use_case || source.source_use_case || source.summary_type || source.analysis_type) || null,
    model: normalizeText(source.model) || null,
    target_language: normalizeText(source.target_language || source.language) || null,
    audience: normalizeText(source.audience) || null,
    status: normalizeText(source.status) || null,
    failure_code: normalizeText(source.failure_code) || null,
    guardrail_code: normalizeText(source.guardrail_code) || null,
    project_id: normalizeText(source.project_id) || null,
    thread_id: normalizeText(source.thread_id) || null,
    run_id: normalizeText(source.run_id) || null,
  };
}

function listRecentAiAuditEvents(db, limit = 20) {
  const placeholders = AI_AUDIT_ACTIONS.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT action, actor_id, meta_json, created_at
       FROM audit_logs
       WHERE tenant_id=? AND action IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(DEFAULT_TENANT, ...AI_AUDIT_ACTIONS, limit);
  return rows.map((row) => ({
    action: row.action,
    actor_id: normalizeText(row.actor_id) || null,
    created_at: row.created_at,
    meta: summarizeAuditMeta(parseJsonSafe(row.meta_json)),
  }));
}

function listAiAuditCounts(db) {
  const placeholders = AI_AUDIT_ACTIONS.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT action, COUNT(*) AS count
       FROM audit_logs
       WHERE tenant_id=? AND action IN (${placeholders})
       GROUP BY action
       ORDER BY count DESC, action ASC`
    )
    .all(DEFAULT_TENANT, ...AI_AUDIT_ACTIONS);
  return rows.map((row) => ({
    action: row.action,
    count: Number(row.count || 0),
  }));
}

function collectTenantSummary(db) {
  const organizationCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM organizations WHERE tenant_id=?").get(DEFAULT_TENANT).count || 0
  );
  const projectCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM projects WHERE tenant_id=?").get(DEFAULT_TENANT).count || 0
  );
  return {
    tenant_id: DEFAULT_TENANT,
    organization_count: organizationCount,
    project_count: projectCount,
  };
}

async function handleAdminAiOverview(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  try {
    const metrics = listWorkspaceMetrics(db, {});
    return sendJson(res, 200, {
      generated_at: new Date().toISOString(),
      scope: collectTenantSummary(db),
      ai_usage_metrics: {
        ai_requests: metrics.ai_requests,
        ai_failures: metrics.ai_failures,
        ai_latency: metrics.ai_latency,
        ai_token_usage: metrics.ai_token_usage,
        summary_requests: metrics.summary_requests,
        analysis_requests: metrics.analysis_requests,
        translation_requests: metrics.translation_requests,
      },
      faq_usage: {
        faq_queries: metrics.faq_queries,
        faq_resolution_rate: metrics.faq_resolution_rate,
      },
      language_policy: {
        default_language: "ja",
        supported_languages: ["ja", "en"],
        glossary_path: "docs/i18n/glossary.md",
        language_distribution: metrics.language_distribution,
      },
      audit_overview: {
        tracked_actions: AI_AUDIT_ACTIONS,
        event_counts: listAiAuditCounts(db),
        recent_events: listRecentAiAuditEvents(db, 20),
      },
    });
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      error.code || "SERVICE_UNAVAILABLE",
      error.message || "admin ai overview failed",
      error.details || { failure_code: error.failure_code || "service_unavailable" }
    );
  }
}

module.exports = {
  handleAdminAiOverview,
};
