const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { recordAudit, AUDIT_ACTIONS } = require("../../src/middleware/audit");
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
    name: `AI Admin Org ${Date.now()}`,
    slug: `ai-admin-org-${Date.now()}`,
  });

  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.AI_REQUESTED,
      meta: { provider: "openai", use_case: "summary", model: "gpt-5-mini", status: "ok" },
    });
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.FAQ_ANSWERED,
      meta: { audience: "operator", language: "ja", confidence: "high", status: "ok" },
    });
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.FAQ_GUARDRAIL_APPLIED,
      meta: { audience: "general", language: "en", guardrail_code: "billing_decision" },
    });

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: actorId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const res = await requestLocal(handler, {
      method: "GET",
      url: "/api/admin/ai-overview",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(res.statusCode === 200, `admin ai overview should return 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body.toString("utf8"));
    assert(body.scope.organization_count >= 1, "ai overview should include organization count");
    assert(body.ai_usage_metrics && body.ai_usage_metrics.ai_requests, "ai overview should include ai usage metrics");
    assert(body.faq_usage && body.faq_usage.faq_queries, "ai overview should include faq usage");
    assert(body.language_policy.default_language === "ja", "ai overview should fix default language");
    assert(Array.isArray(body.audit_overview.recent_events), "ai overview should include recent ai audit events");
    assert(body.audit_overview.recent_events.some((event) => event.action === "faq.guardrail_applied"), "ai overview should include faq guardrail event");
  } finally {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
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
