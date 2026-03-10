const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");
const {
  listRegistryWithPolicies,
  upsertFaqKnowledgeSourcePolicy,
} = require("../../db/faqKnowledgeSources");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeEntry(entry) {
  return {
    source_type: entry.source_type,
    title: entry.title,
    path: entry.path,
    enabled: Boolean(entry.enabled),
    priority: Number(entry.priority || 0),
    audiences: Array.isArray(entry.audiences) ? entry.audiences : [],
    public_scope: entry.public_scope || "both",
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    policy_updated_at: entry.policy_updated_at || null,
  };
}

async function handleAdminKnowledgeSources(req, res, db, { userId = "" } = {}) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const path = parsedUrl.pathname;

  if (path === "/api/admin/knowledge-sources") {
    if (method === "GET") {
      const sources = listRegistryWithPolicies(db, DEFAULT_TENANT).map(summarizeEntry);
      return sendJson(res, 200, {
        sources,
        runbook_paths: sources.filter((entry) => entry.source_type === "runbook").map((entry) => entry.path),
        glossary_path: "docs/i18n/glossary.md",
        faq_model_path: "docs/ai/core/faq-model.md",
      });
    }
    if (method === "PUT") {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
      }
      try {
        const updated = upsertFaqKnowledgeSourcePolicy(db, body, DEFAULT_TENANT);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.KNOWLEDGE_SOURCE_POLICY_UPDATE || AUDIT_ACTIONS.UNKNOWN,
          meta: {
            path: updated.path,
            source_type: updated.source_type,
            enabled: updated.enabled,
            priority: updated.priority,
            audiences: updated.audiences,
            public_scope: updated.public_scope,
          },
        });
        return sendJson(res, 200, summarizeEntry(updated));
      } catch (error) {
        return jsonError(
          res,
          error.status || 400,
          error.code || "VALIDATION_ERROR",
          error.message || "invalid knowledge source payload",
          error.details || { failure_code: "validation_error" }
        );
      }
    }
  }

  return false;
}

module.exports = {
  handleAdminKnowledgeSources,
};
