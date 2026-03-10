"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("./sqlite");

const ROOT_DIR = path.join(__dirname, "..", "..");

const FAQ_SOURCE_REGISTRY = Object.freeze([
  {
    source_type: "workflow",
    title: "Phase Workflow",
    path: "docs/ai/core/workflow.md",
    audiences: ["general", "operator"],
    keywords: ["phase5", "openai", "faq", "workspace", "workflow", "対象", "境界", "phase", "scope"],
  },
  {
    source_type: "sot",
    title: "OpenAI Assist Model",
    path: "docs/ai/core/openai-assist-model.md",
    audiences: ["general", "operator"],
    keywords: ["openai", "summary", "analysis", "translation", "faq", "要約", "分析", "翻訳", "faq回答"],
  },
  {
    source_type: "sot",
    title: "FAQ Knowledge Source Model",
    path: "docs/ai/core/faq-model.md",
    audiences: ["general", "operator"],
    keywords: ["faq", "knowledge", "source", "evidence", "manual", "runbook", "sot", "知識源", "根拠"],
  },
  {
    source_type: "sot",
    title: "AI Evidence Model",
    path: "docs/ai/core/ai-evidence-model.md",
    audiences: ["operator"],
    keywords: ["evidence", "evidence_refs", "root cause", "根拠", "manual", "runbook", "doc_source"],
  },
  {
    source_type: "sot",
    title: "OpenAI Data Boundary",
    path: "docs/ai/core/openai-data-boundary.md",
    audiences: ["operator"],
    keywords: ["boundary", "secret", "confirm_token", "redact", "送信境界", "秘匿", "secret"],
  },
  {
    source_type: "sot",
    title: "Workspace IA Phase5",
    path: "docs/ai/core/workspace-ia-phase5.md",
    audiences: ["general", "operator"],
    keywords: ["workspace", "ia", "left", "center", "right", "横断ナビ", "ai作業面", "recent files"],
  },
  {
    source_type: "runbook",
    title: "VPS External Operations Checklist",
    path: "docs/runbooks/vps-external-operations-checklist.md",
    audiences: ["operator"],
    keywords: ["vps", "deploy", "reflection", "external operations", "checklist", "反映", "確認", "vps反映"],
  },
  {
    source_type: "runbook",
    title: "VPS Workspace Phase3 Checklist",
    path: "docs/runbooks/vps-workspace-phase3-checklist.md",
    audiences: ["operator"],
    keywords: ["workspace", "checklist", "phase3", "vps", "thread", "chat", "反映後", "workspace確認"],
  },
  {
    source_type: "runbook",
    title: "Fidelity Hardening Operations",
    path: "docs/runbooks/fidelity-hardening-operations.md",
    audiences: ["operator"],
    keywords: ["fidelity", "production", "staging", "localhost", "hardening", "再現度", "環境比較"],
  },
  {
    source_type: "manual",
    title: "PR Gate Manual",
    path: "docs/ai/core/MANUAL_pr-gate.md",
    audiences: ["operator"],
    keywords: ["pr", "gate", "manual", "workflow", "conflict", "運用", "手順"],
  },
  {
    source_type: "srs",
    title: "README Product Overview",
    path: "README.md",
    audiences: ["general"],
    keywords: ["product", "ui", "phase5", "workspace", "openai", "faq", "本体ui"],
  },
]);

const PUBLIC_SCOPES = Object.freeze(["both", "general_only", "operator_only", "internal_only"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso() {
  return new Date().toISOString();
}

function tokenize(text) {
  const source = normalizeText(text).toLowerCase();
  if (!source) return [];
  const matches = source.match(/[a-z0-9_]+|[ぁ-んァ-ヶー一-龠]{2,}/g) || [];
  return Array.from(new Set(matches.filter(Boolean)));
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildExcerpt(lines, index) {
  if (!Array.isArray(lines) || index < 0) return "";
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + 2);
  return lines.slice(start, end).map((line) => normalizeText(line)).filter(Boolean).join(" ").slice(0, 400);
}

function buildSectionMap(text) {
  const lines = String(text || "").split(/\r?\n/);
  let currentSection = "";
  return lines.map((line) => {
    const heading = normalizeText(line).match(/^#{1,6}\s+(.+)$/);
    if (heading && heading[1]) {
      currentSection = normalizeText(heading[1]);
    }
    return { line, section: currentSection };
  });
}

function scoreSource(questionTokens, entry, text, sectionLines) {
  const lowerText = String(text || "").toLowerCase();
  const lowerTitle = `${normalizeText(entry.title)} ${normalizeText(entry.path)}`.toLowerCase();
  const keywordSet = Array.isArray(entry.keywords) ? entry.keywords.map((item) => normalizeText(item).toLowerCase()).filter(Boolean) : [];
  let score = 0;
  let bestLineIndex = -1;
  let bestLineScore = 0;

  questionTokens.forEach((token) => {
    if (lowerTitle.includes(token)) score += 4;
    if (keywordSet.some((keyword) => keyword.includes(token) || token.includes(keyword))) score += 5;
    if (token.length >= 3 && lowerText.includes(token)) score += 1;
  });

  sectionLines.forEach((row, index) => {
    const lowerLine = String(row.line || "").toLowerCase();
    let lineScore = 0;
    questionTokens.forEach((token) => {
      if (token.length >= 2 && lowerLine.includes(token)) lineScore += 2;
    });
    if (lineScore > bestLineScore) {
      bestLineScore = lineScore;
      bestLineIndex = index;
    }
  });
  score += bestLineScore;
  return { score, bestLineIndex };
}

function normalizeAudienceList(value, fallback = ["general", "operator"]) {
  const source = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(
      source
        .map((item) => normalizeText(item).toLowerCase())
        .filter((item) => item === "general" || item === "operator")
    )
  );
  return normalized.length ? normalized : fallback.slice();
}

function parseJsonSafe(value, fallback = []) {
  const text = normalizeText(value);
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function defaultPriorityFor(entry, index) {
  const audienceWeight = Array.isArray(entry.audiences) && entry.audiences.includes("operator") && !entry.audiences.includes("general")
    ? 60
    : 100;
  return audienceWeight + index * 10;
}

function listRegistryWithPolicies(db = null, tenantId = DEFAULT_TENANT) {
  const policyRows =
    db &&
    typeof db.prepare === "function"
      ? db
          .prepare(
            `SELECT source_path, enabled, priority, audiences_json, public_scope, updated_at
             FROM faq_knowledge_source_policies
             WHERE tenant_id=?`
          )
          .all(tenantId)
      : [];
  const policyMap = new Map(
    policyRows.map((row) => [
      normalizeText(row.source_path),
      {
        enabled: Number(row.enabled || 0) === 1,
        priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
        audiences: normalizeAudienceList(parseJsonSafe(row.audiences_json, [])),
        public_scope: PUBLIC_SCOPES.includes(normalizeText(row.public_scope)) ? normalizeText(row.public_scope) : "both",
        updated_at: normalizeText(row.updated_at) || null,
      },
    ])
  );
  return FAQ_SOURCE_REGISTRY.map((entry, index) => {
    const policy = policyMap.get(entry.path);
    return {
      ...entry,
      enabled: policy ? policy.enabled : true,
      priority: policy ? policy.priority : defaultPriorityFor(entry, index),
      audiences: policy ? policy.audiences : normalizeAudienceList(entry.audiences, ["general"]),
      public_scope: policy ? policy.public_scope : "both",
      policy_updated_at: policy ? policy.updated_at : null,
    };
  });
}

function matchesAudiencePolicy(entry, audience) {
  const normalizedAudience = normalizeText(audience).toLowerCase() === "operator" ? "operator" : "general";
  const allowedAudiences = normalizeAudienceList(entry.audiences, ["general", "operator"]);
  if (!allowedAudiences.includes(normalizedAudience)) return false;
  const scope = normalizeText(entry.public_scope) || "both";
  if (normalizedAudience === "general") {
    return scope === "both" || scope === "general_only";
  }
  return scope === "both" || scope === "operator_only" || scope === "internal_only";
}

function listFaqKnowledgeSources({ db = null, tenantId = DEFAULT_TENANT, audience = "general" } = {}) {
  const normalizedAudience = normalizeText(audience).toLowerCase() === "operator" ? "operator" : "general";
  return listRegistryWithPolicies(db, tenantId)
    .filter((entry) => entry.enabled)
    .filter((entry) => matchesAudiencePolicy(entry, normalizedAudience))
    .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
}

function searchFaqKnowledgeSources({ db = null, tenantId = DEFAULT_TENANT, question = "", audience = "general", limit = 4 } = {}) {
  const normalizedQuestion = normalizeText(question);
  const questionTokens = tokenize(normalizedQuestion);
  const candidates = listFaqKnowledgeSources({ db, tenantId, audience }).map((entry) => {
    const absolutePath = path.join(ROOT_DIR, entry.path);
    const text = safeRead(absolutePath);
    const sectionLines = buildSectionMap(text);
    const scoreResult = scoreSource(questionTokens, entry, text, sectionLines);
    const sectionRow = scoreResult.bestLineIndex >= 0 ? sectionLines[scoreResult.bestLineIndex] : null;
    return {
      source_type: entry.source_type,
      title: entry.title,
      path: entry.path,
      audience: normalizeText(audience).toLowerCase() === "operator" ? "operator" : "general",
      enabled: entry.enabled,
      priority: entry.priority,
      public_scope: entry.public_scope,
      section: normalizeText(sectionRow && sectionRow.section),
      ref_kind: normalizeText(sectionRow && sectionRow.section) ? "section" : "document",
      excerpt: buildExcerpt(sectionLines.map((row) => row.line), scoreResult.bestLineIndex),
      score: scoreResult.score + Math.max(0, 30 - Number(entry.priority || 0)),
    };
  });
  return candidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.priority - b.priority || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 4)));
}

function validatePolicyPayload(payload = {}) {
  const sourcePath = normalizeText(payload.source_path);
  if (!sourcePath) {
    const error = new Error("source_path is required");
    error.status = 400;
    error.code = "VALIDATION_ERROR";
    error.details = { failure_code: "validation_error", field: "source_path" };
    throw error;
  }
  if (!FAQ_SOURCE_REGISTRY.some((entry) => entry.path === sourcePath)) {
    const error = new Error("source_path is not registered");
    error.status = 400;
    error.code = "VALIDATION_ERROR";
    error.details = { failure_code: "validation_error", field: "source_path" };
    throw error;
  }
  const publicScope = normalizeText(payload.public_scope) || "both";
  if (!PUBLIC_SCOPES.includes(publicScope)) {
    const error = new Error("public_scope is invalid");
    error.status = 400;
    error.code = "VALIDATION_ERROR";
    error.details = { failure_code: "validation_error", field: "public_scope" };
    throw error;
  }
  return {
    source_path: sourcePath,
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
    priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 100,
    audiences: normalizeAudienceList(payload.audiences, ["general", "operator"]),
    public_scope: publicScope,
  };
}

function upsertFaqKnowledgeSourcePolicy(db, payload = {}, tenantId = DEFAULT_TENANT) {
  const data = validatePolicyPayload(payload);
  db.prepare(
    `INSERT INTO faq_knowledge_source_policies(tenant_id,source_path,enabled,priority,audiences_json,public_scope,updated_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(tenant_id,source_path) DO UPDATE SET
       enabled=excluded.enabled,
       priority=excluded.priority,
       audiences_json=excluded.audiences_json,
       public_scope=excluded.public_scope,
       updated_at=excluded.updated_at`
  ).run(
    tenantId,
    data.source_path,
    data.enabled ? 1 : 0,
    data.priority,
    JSON.stringify(data.audiences),
    data.public_scope,
    nowIso()
  );
  return listRegistryWithPolicies(db, tenantId).find((entry) => entry.path === data.source_path) || null;
}

module.exports = {
  FAQ_SOURCE_REGISTRY,
  PUBLIC_SCOPES,
  listFaqKnowledgeSources,
  listRegistryWithPolicies,
  searchFaqKnowledgeSources,
  upsertFaqKnowledgeSourcePolicy,
};
