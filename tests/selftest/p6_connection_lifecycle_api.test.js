const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createOrganization } = require("../../src/server/organizationAdminStore");
const { createProject } = require("../../src/api/projects");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const actorId = `acct-${crypto.randomUUID()}`;
  const accountScopeId = `acct-scope-${crypto.randomUUID()}`;
  const org = createOrganization(db, {
    name: `Conn Org ${Date.now()}`,
    slug: `conn-org-${Date.now()}`,
  });
  const project = createProject(
    db,
    `Conn Project ${Date.now()}`,
    "https://example.test",
    actorId
  );

  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: actorId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const accountRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/admin/connections",
      headers,
      body: JSON.stringify({
        provider_key: "openai",
        scope_type: "account",
        scope_id: accountScopeId,
        secret_ref: "env://OPENAI_API_KEY",
        config: { model: "gpt-5-mini", use_cases: ["summary", "faq"] },
        policy: { allowed_use_cases: ["summary", "faq"], reauth_interval_days: 30 },
      }),
    });
    assert(accountRes.statusCode === 201, `account add should return 201, got ${accountRes.statusCode}`);
    const accountBody = JSON.parse(accountRes.body.toString("utf8"));
    assert(accountBody.scope_type === "account", "account scope should be preserved");

    const orgRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/admin/connections",
      headers,
      body: JSON.stringify({
        provider_key: "github",
        scope_type: "organization",
        scope_id: org.id,
        secret_ref: "vault://org/github",
        config: { repository: "owner/repo", writable_scope: "docs/" },
        policy: { allowed_projects: [project.id], auto_disable_on_failure: true },
      }),
    });
    assert(orgRes.statusCode === 201, `organization add should return 201, got ${orgRes.statusCode}`);
    const orgBody = JSON.parse(orgRes.body.toString("utf8"));
    assert(orgBody.scope_id === org.id, "organization scope should use organization boundary");

    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/admin/connections",
      headers,
      body: JSON.stringify({
        provider_key: "figma",
        scope_type: "project",
        scope_id: project.id,
        secret_ref: "vault://project/figma",
        config: { file_key: "abc123", page_scope: "Design" },
      }),
    });
    assert(projectRes.statusCode === 201, `project add should return 201, got ${projectRes.statusCode}`);
    const projectBody = JSON.parse(projectRes.body.toString("utf8"));
    assert(projectBody.scope_type === "project", "project scope should be preserved");

    const listOrgRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/connections?scope_type=organization&scope_id=${org.id}`,
      headers,
    });
    assert(listOrgRes.statusCode === 200, `organization list should return 200, got ${listOrgRes.statusCode}`);
    const listOrgBody = JSON.parse(listOrgRes.body.toString("utf8"));
    assert(listOrgBody.items.length === 1, "filtered organization list should include one item");

    const reauthRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/connections/${orgBody.connection_id}/reauth`,
      headers,
      body: JSON.stringify({
        secret_ref: "vault://org/github/rotated",
        policy: { allowed_projects: [project.id], reauth_interval_days: 14 },
      }),
    });
    assert(reauthRes.statusCode === 200, `reauth should return 200, got ${reauthRes.statusCode}`);
    const reauthBody = JSON.parse(reauthRes.body.toString("utf8"));
    assert(reauthBody.secret_ref === "vault://org/github/rotated", "reauth should update secret_ref");
    assert(reauthBody.status === "active", "reauth should restore active status");

    const disableRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/connections/${projectBody.connection_id}/disable`,
      headers,
    });
    assert(disableRes.statusCode === 200, `disable should return 200, got ${disableRes.statusCode}`);
    const disableBody = JSON.parse(disableRes.body.toString("utf8"));
    assert(disableBody.status === "disabled", "disable should set disabled status");

    const policyRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/admin/connections/${accountBody.connection_id}/policy`,
      headers,
      body: JSON.stringify({
        allowed_use_cases: ["summary"],
        auto_disable_on_failure: true,
        reauth_interval_days: 7,
      }),
    });
    assert(policyRes.statusCode === 200, `policy update should return 200, got ${policyRes.statusCode}`);
    const policyBody = JSON.parse(policyRes.body.toString("utf8"));
    assert(policyBody.policy.allowed_use_cases.length === 1, "policy update should persist allowed_use_cases");

    const deleteRes = await requestLocal(handler, {
      method: "DELETE",
      url: `/api/admin/connections/${accountBody.connection_id}`,
      headers,
    });
    assert(deleteRes.statusCode === 204, `delete should return 204, got ${deleteRes.statusCode}`);

    const auditRows = db
      .prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, actorId);
    assert(auditRows.some((row) => row.action === "connection.lifecycle.add"), "audit should record add");
    assert(auditRows.some((row) => row.action === "connection.lifecycle.reauth"), "audit should record reauth");
    assert(auditRows.some((row) => row.action === "connection.lifecycle.disable"), "audit should record disable");
    assert(auditRows.some((row) => row.action === "connection.policy.update"), "audit should record policy update");
    assert(auditRows.some((row) => row.action === "connection.lifecycle.delete"), "audit should record delete");
  } finally {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, actorId);
    db.prepare("DELETE FROM connections WHERE tenant_id=? AND (scope_id=? OR scope_id=? OR scope_id=?)").run(
      DEFAULT_TENANT,
      accountScopeId,
      org.id,
      project.id
    );
    db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, project.id);
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
