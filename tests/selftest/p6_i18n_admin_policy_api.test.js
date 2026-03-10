const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createOrganization } = require("../../src/server/organizationAdminStore");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const actorId = `acct-${crypto.randomUUID()}`;
  const org = createOrganization(db, {
    name: `I18N Org ${Date.now()}`,
    slug: `i18n-org-${Date.now()}`,
  });

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: actorId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const getRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/i18n-policy?organization_id=${encodeURIComponent(org.id)}`,
      headers,
    });
    assert(getRes.statusCode === 200, `i18n policy get should return 200, got ${getRes.statusCode}`);
    const getBody = JSON.parse(getRes.body.toString("utf8"));
    assert(getBody.policy.default_language === "ja", "default language should start as ja");
    assert(Array.isArray(getBody.glossary.fixed_terms), "glossary summary should include fixed terms");

    const putRes = await requestLocal(handler, {
      method: "PUT",
      url: "/api/admin/i18n-policy",
      headers,
      body: JSON.stringify({
        organization_id: org.id,
        default_language: "en",
        supported_languages: ["ja", "en"],
        glossary_mode: "managed_terms_with_labels",
      }),
    });
    assert(putRes.statusCode === 200, `i18n policy put should return 200, got ${putRes.statusCode}`);
    const putBody = JSON.parse(putRes.body.toString("utf8"));
    assert(putBody.policy.default_language === "en", "i18n policy should persist default language");
    assert(putBody.policy.glossary_mode === "managed_terms_with_labels", "i18n policy should persist glossary mode");

    const row = db
      .prepare("SELECT default_language, glossary_mode FROM organization_language_policies WHERE tenant_id=? AND organization_id=?")
      .get(DEFAULT_TENANT, org.id);
    assert(row && row.default_language === "en", "organization language policy should be stored");
  } finally {
    db.prepare("DELETE FROM organization_language_policies WHERE tenant_id=? AND organization_id=?").run(DEFAULT_TENANT, org.id);
    db.prepare("DELETE FROM organization_invites WHERE tenant_id=? AND organization_id=?").run(DEFAULT_TENANT, org.id);
    db.prepare("DELETE FROM organization_members WHERE tenant_id=? AND organization_id=?").run(DEFAULT_TENANT, org.id);
    db.prepare("DELETE FROM organization_roles WHERE tenant_id=? AND organization_id=?").run(DEFAULT_TENANT, org.id);
    db.prepare("DELETE FROM organizations WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, org.id);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
