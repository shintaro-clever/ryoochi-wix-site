const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");
const {
  getOrganizationLanguagePolicy,
  parseGlossaryTerms,
  putOrganizationLanguagePolicy,
  SUPPORTED_GLOSSARY_MODES,
  SUPPORTED_LANGUAGES,
} = require("../adminI18nPolicyStore");
const { listOrganizations } = require("../organizationAdminStore");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function handleAdminI18nPolicy(req, res, db, { userId = "" } = {}) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const path = parsedUrl.pathname;
  if (path !== "/api/admin/i18n-policy") {
    return false;
  }

  const organizations = listOrganizations(db, DEFAULT_TENANT);
  const organizationId =
    normalizeText(parsedUrl.searchParams.get("organization_id")) ||
    normalizeText(organizations[0] && organizations[0].organization_id);

  if (!organizationId) {
    return sendJson(res, 200, {
      organizations: [],
      policy: null,
      glossary: parseGlossaryTerms(),
      supported_languages: SUPPORTED_LANGUAGES,
      glossary_modes: SUPPORTED_GLOSSARY_MODES,
    });
  }

  if (method === "GET") {
    try {
      return sendJson(res, 200, {
        organizations,
        policy: getOrganizationLanguagePolicy(db, organizationId, DEFAULT_TENANT),
        glossary: parseGlossaryTerms(),
        supported_languages: SUPPORTED_LANGUAGES,
        glossary_modes: SUPPORTED_GLOSSARY_MODES,
      });
    } catch (error) {
      return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "invalid organization", error.details);
    }
  }

  if (method === "PUT") {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    const targetOrganizationId = normalizeText(body.organization_id) || organizationId;
    try {
      const policy = putOrganizationLanguagePolicy(db, targetOrganizationId, body, DEFAULT_TENANT);
      recordAudit({
        db,
        tenantId: DEFAULT_TENANT,
        actorId: normalizeText(userId) || null,
        action: AUDIT_ACTIONS.LANGUAGE_POLICY_UPDATE || AUDIT_ACTIONS.UNKNOWN,
        meta: {
          organization_id: targetOrganizationId,
          default_language: policy.default_language,
          supported_languages: policy.supported_languages,
          glossary_mode: policy.glossary_mode,
          glossary_path: policy.glossary_path,
        },
      });
      return sendJson(res, 200, {
        organizations,
        policy,
        glossary: parseGlossaryTerms(),
        supported_languages: SUPPORTED_LANGUAGES,
        glossary_modes: SUPPORTED_GLOSSARY_MODES,
      });
    } catch (error) {
      return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "invalid language policy", error.details);
    }
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
  return true;
}

module.exports = {
  handleAdminI18nPolicy,
};
