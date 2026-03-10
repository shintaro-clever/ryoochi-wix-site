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
  const memberAccountId = `acct-${crypto.randomUUID()}`;
  const org = createOrganization(db, {
    name: `Phase6 Org ${Date.now()}`,
    slug: `phase6-org-${Date.now()}`,
  });

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

    const rolesRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/organizations/${org.id}/roles`,
      headers,
    });
    assert(rolesRes.statusCode === 200, `roles list should return 200, got ${rolesRes.statusCode}`);
    const rolesBody = JSON.parse(rolesRes.body.toString("utf8"));
    assert(Array.isArray(rolesBody.roles), "roles list should return roles");
    const opsAdmin = rolesBody.roles.find((role) => role.key === "ops_admin");
    assert(opsAdmin, "default ops_admin role should exist");
    assert(!("project_id" in opsAdmin), "role payload should not mix project boundary");

    const orgListRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/admin/organizations",
      headers,
    });
    assert(orgListRes.statusCode === 200, `organization list should return 200, got ${orgListRes.statusCode}`);
    const orgListBody = JSON.parse(orgListRes.body.toString("utf8"));
    assert(orgListBody.organizations.some((item) => item.organization_id === org.id), "organization list should include created org");

    const roleUpsertRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/organizations/${org.id}/roles`,
      headers,
      body: JSON.stringify({
        key: "billing_reviewer",
        name: "Billing Reviewer",
        description: "Review usage and audit without mutating project workspace.",
        permissions: ["audit.view", "ai_usage.manage"],
      }),
    });
    assert(roleUpsertRes.statusCode === 200, `role upsert should return 200, got ${roleUpsertRes.statusCode}`);
    const roleUpsertBody = JSON.parse(roleUpsertRes.body.toString("utf8"));
    assert(roleUpsertBody.key === "billing_reviewer", "role upsert should persist key");

    const memberCreateRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/organizations/${org.id}/members`,
      headers,
      body: JSON.stringify({
        account_id: memberAccountId,
        email: "operator@example.com",
        display_name: "Operator User",
        role_ids: [opsAdmin.role_id],
      }),
    });
    assert(memberCreateRes.statusCode === 201, `member create should return 201, got ${memberCreateRes.statusCode}`);
    const memberBody = JSON.parse(memberCreateRes.body.toString("utf8"));
    assert(memberBody.account_id === memberAccountId, "member should preserve account boundary");
    assert(!("project_id" in memberBody), "member payload should not include project_id");

    const memberPatchRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/admin/organizations/${org.id}/members/${memberBody.member_id}`,
      headers,
      body: JSON.stringify({
        role_ids: [opsAdmin.role_id, roleUpsertBody.role_id],
        status: "active",
      }),
    });
    assert(memberPatchRes.statusCode === 200, `member patch should return 200, got ${memberPatchRes.statusCode}`);
    const memberPatchBody = JSON.parse(memberPatchRes.body.toString("utf8"));
    assert(memberPatchBody.assigned_role_ids.length === 2, "member role update should persist both role ids");

    const inviteCreateRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/organizations/${org.id}/invites`,
      headers,
      body: JSON.stringify({
        email: "invitee@example.com",
        proposed_role_ids: [roleUpsertBody.role_id],
      }),
    });
    assert(inviteCreateRes.statusCode === 201, `invite create should return 201, got ${inviteCreateRes.statusCode}`);
    const inviteBody = JSON.parse(inviteCreateRes.body.toString("utf8"));
    assert(inviteBody.status === "pending", "invite should start pending");

    const inviteRevokeRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/admin/organizations/${org.id}/invites/${inviteBody.invite_id}/revoke`,
      headers,
    });
    assert(inviteRevokeRes.statusCode === 200, `invite revoke should return 200, got ${inviteRevokeRes.statusCode}`);
    const inviteRevokeBody = JSON.parse(inviteRevokeRes.body.toString("utf8"));
    assert(inviteRevokeBody.status === "revoked", "invite revoke should set revoked status");

    const membersListRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/organizations/${org.id}/members`,
      headers,
    });
    assert(membersListRes.statusCode === 200, `members list should return 200, got ${membersListRes.statusCode}`);
    const membersListBody = JSON.parse(membersListRes.body.toString("utf8"));
    assert(membersListBody.members.length >= 1, "members list should include created member");

    const invitesListRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/organizations/${org.id}/invites`,
      headers,
    });
    assert(invitesListRes.statusCode === 200, `invites list should return 200, got ${invitesListRes.statusCode}`);
    const invitesListBody = JSON.parse(invitesListRes.body.toString("utf8"));
    assert(invitesListBody.invites.length >= 1, "invites list should include created invite");

    const auditRows = db
      .prepare("SELECT action, meta_json FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, actorId);
    assert(auditRows.some((row) => row.action === "org.role.upsert"), "audit should record role upsert");
    assert(auditRows.some((row) => row.action === "org.member.role_update"), "audit should record member role update");
    assert(auditRows.some((row) => row.action === "org.invite.create"), "audit should record invite create");
    assert(auditRows.some((row) => row.action === "org.invite.revoke"), "audit should record invite revoke");
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
