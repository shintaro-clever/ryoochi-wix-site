const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("../db");
const { requireOrganization } = require("./organizationAdminStore");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DEFAULT_GLOSSARY_PATH = "docs/i18n/glossary.md";
const SUPPORTED_LANGUAGES = Object.freeze(["ja", "en"]);
const SUPPORTED_GLOSSARY_MODES = Object.freeze(["managed_terms_locked", "managed_terms_with_labels"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLanguageList(value) {
  const items = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(
      items.map((item) => normalizeText(item).toLowerCase()).filter((item) => SUPPORTED_LANGUAGES.includes(item))
    )
  );
  return normalized.length ? normalized : ["ja", "en"];
}

function validationError(message, details = {}) {
  return {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details: { failure_code: "validation_error", ...details },
  };
}

function parseGlossaryTerms() {
  const glossaryPath = path.join(ROOT_DIR, DEFAULT_GLOSSARY_PATH);
  let text = "";
  try {
    text = fs.readFileSync(glossaryPath, "utf8");
  } catch {
    return { path: DEFAULT_GLOSSARY_PATH, fixed_terms: [] };
  }
  const match = text.match(/## Fixed Managed Terms[\s\S]*?(?=## |\Z)/);
  const section = match ? match[0] : "";
  const fixedTerms = Array.from(
    new Set(
      (section.match(/- `([^`]+)`/g) || [])
        .map((item) => item.replace(/^- `|`$/g, "").trim())
        .filter(Boolean)
    )
  );
  return {
    path: DEFAULT_GLOSSARY_PATH,
    fixed_terms: fixedTerms,
  };
}

function mapPolicyRow(row) {
  const supportedLanguages = (() => {
    try {
      const parsed = JSON.parse(row.supported_languages_json);
      return normalizeLanguageList(parsed);
    } catch {
      return ["ja", "en"];
    }
  })();
  return {
    organization_id: row.organization_id,
    default_language: normalizeText(row.default_language) || "ja",
    supported_languages: supportedLanguages,
    glossary_mode: normalizeText(row.glossary_mode) || "managed_terms_locked",
    glossary_path: normalizeText(row.glossary_path) || DEFAULT_GLOSSARY_PATH,
    updated_at: row.updated_at,
  };
}

function getOrganizationLanguagePolicy(db, organizationId, tenantId = DEFAULT_TENANT) {
  requireOrganization(db, organizationId, tenantId);
  const row = db
    .prepare(
      `SELECT organization_id, default_language, supported_languages_json, glossary_mode, glossary_path, updated_at
       FROM organization_language_policies
       WHERE tenant_id=? AND organization_id=?
       LIMIT 1`
    )
    .get(tenantId, organizationId);
  if (row) return mapPolicyRow(row);
  return {
    organization_id: organizationId,
    default_language: "ja",
    supported_languages: ["ja", "en"],
    glossary_mode: "managed_terms_locked",
    glossary_path: DEFAULT_GLOSSARY_PATH,
    updated_at: null,
  };
}

function putOrganizationLanguagePolicy(db, organizationId, payload = {}, tenantId = DEFAULT_TENANT) {
  requireOrganization(db, organizationId, tenantId);
  const defaultLanguage = normalizeText(payload.default_language).toLowerCase() || "ja";
  if (!SUPPORTED_LANGUAGES.includes(defaultLanguage)) {
    throw validationError("default_language is invalid", { field: "default_language" });
  }
  const supportedLanguages = normalizeLanguageList(payload.supported_languages);
  if (!supportedLanguages.includes(defaultLanguage)) {
    throw validationError("default_language must be included in supported_languages", { field: "supported_languages" });
  }
  const glossaryMode = normalizeText(payload.glossary_mode) || "managed_terms_locked";
  if (!SUPPORTED_GLOSSARY_MODES.includes(glossaryMode)) {
    throw validationError("glossary_mode is invalid", { field: "glossary_mode" });
  }
  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO organization_language_policies(
      tenant_id, organization_id, default_language, supported_languages_json, glossary_mode, glossary_path, updated_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id, organization_id) DO UPDATE SET
      default_language=excluded.default_language,
      supported_languages_json=excluded.supported_languages_json,
      glossary_mode=excluded.glossary_mode,
      glossary_path=excluded.glossary_path,
      updated_at=excluded.updated_at`
  ).run(
    tenantId,
    organizationId,
    defaultLanguage,
    JSON.stringify(supportedLanguages),
    glossaryMode,
    DEFAULT_GLOSSARY_PATH,
    updatedAt
  );
  return getOrganizationLanguagePolicy(db, organizationId, tenantId);
}

module.exports = {
  DEFAULT_GLOSSARY_PATH,
  SUPPORTED_GLOSSARY_MODES,
  SUPPORTED_LANGUAGES,
  getOrganizationLanguagePolicy,
  parseGlossaryTerms,
  putOrganizationLanguagePolicy,
};
