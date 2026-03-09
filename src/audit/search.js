"use strict";

const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { DEFAULT_TENANT } = require("../db/sqlite");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeSecretLike(text) {
  let value = asText(text);
  if (!value) return { value: "", redacted: false };
  const patterns = [
    /(env|vault):\/\/[^\s"'`]+/gi,
    /\b(ghp|gho|ghu|ghs|ghr|github_pat|sk|figd|figma)_[A-Za-z0-9_-]+\b/gi,
    /\bconfirm_token\s*=\s*[^\s,;]+/gi,
    /\bsecret_id\s*=\s*[^\s,;]+/gi,
    /\b(token|password|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
  ];
  let redacted = false;
  patterns.forEach((pattern) => {
    if (pattern.test(value)) {
      redacted = true;
      value = value.replace(pattern, "[redacted]");
    }
    pattern.lastIndex = 0;
  });
  value = value.replace(/\s+/g, " ").trim();
  return { value, redacted };
}

function buildWorkspaceSearchQuerySummary(query) {
  const raw = asText(query);
  const sanitized = sanitizeSecretLike(raw);
  const preview = sanitized.value.length > 120 ? `${sanitized.value.slice(0, 119)}…` : sanitized.value;
  return {
    present: raw.length > 0,
    length: raw.length,
    preview: preview || "",
    redacted: sanitized.redacted,
  };
}

function normalizeStringList(values, max = 10) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const text = asText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function recordWorkspaceSearchAudit(req, db, {
  projectId = "",
  threadId = "",
  scopes = [],
  statusFilter = [],
  providerFilter = [],
  query = "",
  resultCount = 0,
} = {}) {
  const actorId = asText(req && req.user && req.user.id);
  const tenantId = asText(req && req.user && req.user.tenant_id) || DEFAULT_TENANT;
  recordAudit({
    db,
    action: AUDIT_ACTIONS.WORKSPACE_SEARCH,
    tenantId,
    actorId: actorId || null,
    meta: {
      actor: {
        id: actorId || null,
        role: asText(req && req.user && req.user.role) || null,
      },
      requested_by: actorId || "anonymous",
      project_id: asText(projectId) || null,
      thread_id: asText(threadId) || null,
      scope: normalizeStringList(scopes, 10),
      status_filter: normalizeStringList(statusFilter, 20),
      provider_filter: normalizeStringList(providerFilter, 10),
      query_summary: buildWorkspaceSearchQuerySummary(query),
      result_count: Number.isFinite(Number(resultCount)) ? Number(resultCount) : 0,
      recorded_at: new Date().toISOString(),
    },
  });
}

module.exports = {
  buildWorkspaceSearchQuerySummary,
  recordWorkspaceSearchAudit,
};
