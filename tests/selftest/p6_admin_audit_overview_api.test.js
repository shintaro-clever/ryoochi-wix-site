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
    name: `Ops Audit Org ${Date.now()}`,
    slug: `ops-audit-org-${Date.now()}`,
  });

  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.ORG_MEMBER_CREATE,
      meta: { organization_id: org.id, member_id: "member_demo", account_id: "acct_demo" },
    });
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.CONNECTION_LIFECYCLE_REAUTH,
      meta: {
        organization_id: org.id,
        connection_id: "conn_demo",
        provider_key: "github",
        scope_type: "organization",
        scope_id: org.id,
        status: "reauth_required",
      },
    });
    recordAudit({
      db,
      tenantId: DEFAULT_TENANT,
      actorId,
      action: AUDIT_ACTIONS.AI_COMPLETED,
      meta: { provider: "openai", use_case: "summary", project_id: "project_demo", status: "ok" },
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
      url: `/api/admin/audit-overview?organization_id=${encodeURIComponent(org.id)}&limit=20`,
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(res.statusCode === 200, `audit overview should return 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body.toString("utf8"));
    assert(Array.isArray(body.organizations) && body.organizations.some((item) => item.organization_id === org.id), "audit overview should include organizations");
    assert(body.summary.org_events >= 1, "audit overview should count org events");
    assert(body.summary.connection_events >= 1, "audit overview should count connection events");
    assert(Array.isArray(body.timeline), "audit overview should include timeline");
    assert(Array.isArray(body.recent_events) && body.recent_events.some((event) => event.action === "connection.lifecycle.reauth"), "audit overview should include connection events");

    const faqRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/admin/audit-overview?action_group=faq&limit=20",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(faqRes.statusCode === 200, `faq filter should return 200, got ${faqRes.statusCode}`);
    const faqBody = JSON.parse(faqRes.body.toString("utf8"));
    assert(faqBody.summary.faq_events >= 1, "faq filter should count faq events");
    assert(faqBody.recent_events.every((event) => event.group === "faq"), "faq filter should return only faq events");
  } finally {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
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
