const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");
const {
  createOrganization,
  createOrganizationInvite,
  createOrganizationMember,
  listOrganizations,
  listOrganizationInvites,
  listOrganizationMembers,
  listOrganizationRoles,
  requireOrganization,
  revokeOrganizationInvite,
  upsertOrganizationRole,
  updateOrganizationMember,
} = require("../organizationAdminStore");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function routeMatch(urlPath) {
  return urlPath.match(/^\/api\/admin\/organizations\/([^/]+)\/(members|invites|roles)(?:\/([^/]+))?(?:\/(revoke))?$/);
}

async function handleAdminRbac(req, res, db, { userId = "" } = {}) {
  const method = (req.method || "GET").toUpperCase();
  const urlPath = String(req.url || "").split("?")[0];

  if (urlPath === "/api/admin/organizations") {
    if (method === "GET") {
      return sendJson(res, 200, { organizations: listOrganizations(db, DEFAULT_TENANT) });
    }
    if (method === "POST") {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
      }
      try {
        const organization = createOrganization(db, body, DEFAULT_TENANT);
        return sendJson(res, 201, {
          organization_id: organization.id,
          name: organization.name,
          slug: organization.slug || null,
          status: organization.status,
          created_at: organization.created_at,
          updated_at: organization.updated_at,
        });
      } catch (error) {
        return jsonError(
          res,
          error.status || 400,
          error.code || "VALIDATION_ERROR",
          error.message || "入力が不正です",
          error.details || { failure_code: "validation_error" }
        );
      }
    }
  }

  const match = routeMatch(urlPath);
  if (!match) {
    return false;
  }
  const organizationId = normalizeText(match[1]);
  const resource = normalizeText(match[2]);
  const resourceId = normalizeText(match[3]);
  const subAction = normalizeText(match[4]);

  try {
    requireOrganization(db, organizationId, DEFAULT_TENANT);
  } catch (error) {
    return jsonError(
      res,
      error.status || 404,
      error.code || "NOT_FOUND",
      error.message || "organization not found",
      error.details || { failure_code: "not_found" }
    );
  }

  let body = {};
  if (["POST", "PATCH", "PUT"].includes(method)) {
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
  }

  try {
    if (resource === "roles") {
      if (method === "GET" && !resourceId) {
        return sendJson(res, 200, {
          organization_id: organizationId,
          roles: listOrganizationRoles(db, organizationId, DEFAULT_TENANT),
        });
      }
      if (method === "POST" && !resourceId) {
        const row = upsertOrganizationRole(db, organizationId, body, DEFAULT_TENANT);
        const role = listOrganizationRoles(db, organizationId, DEFAULT_TENANT).find((item) => item.role_id === row.id);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.ORG_ROLE_UPSERT,
          meta: {
            organization_id: organizationId,
            role_id: role.role_id,
            key: role.key,
            permissions: role.permissions,
          },
        });
        return sendJson(res, 200, role);
      }
    }

    if (resource === "members") {
      if (method === "GET" && !resourceId) {
        return sendJson(res, 200, {
          organization_id: organizationId,
          members: listOrganizationMembers(db, organizationId, DEFAULT_TENANT),
        });
      }
      if (method === "POST" && !resourceId) {
        const member = createOrganizationMember(db, organizationId, body, DEFAULT_TENANT);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.ORG_MEMBER_CREATE,
          meta: {
            organization_id: organizationId,
            member_id: member.member_id,
            account_id: member.account_id,
            assigned_role_ids: member.assigned_role_ids,
          },
        });
        return sendJson(res, 201, member);
      }
      if (method === "PATCH" && resourceId) {
        const member = updateOrganizationMember(db, organizationId, resourceId, body, DEFAULT_TENANT);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.ORG_MEMBER_ROLE_UPDATE,
          meta: {
            organization_id: organizationId,
            member_id: member.member_id,
            account_id: member.account_id,
            assigned_role_ids: member.assigned_role_ids,
            status: member.status,
          },
        });
        return sendJson(res, 200, member);
      }
    }

    if (resource === "invites") {
      if (method === "GET" && !resourceId) {
        return sendJson(res, 200, {
          organization_id: organizationId,
          invites: listOrganizationInvites(db, organizationId, DEFAULT_TENANT),
        });
      }
      if (method === "POST" && !resourceId) {
        const invite = createOrganizationInvite(db, organizationId, {
          ...body,
          invited_by: normalizeText(body.invited_by) || normalizeText(userId),
        }, DEFAULT_TENANT);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.ORG_INVITE_CREATE,
          meta: {
            organization_id: organizationId,
            invite_id: invite.invite_id,
            email: invite.email,
            proposed_role_ids: invite.proposed_role_ids,
          },
        });
        return sendJson(res, 201, invite);
      }
      if (method === "POST" && resourceId && subAction === "revoke") {
        const invite = revokeOrganizationInvite(db, organizationId, resourceId, DEFAULT_TENANT);
        recordAudit({
          db,
          tenantId: DEFAULT_TENANT,
          actorId: normalizeText(userId) || null,
          action: AUDIT_ACTIONS.ORG_INVITE_REVOKE,
          meta: {
            organization_id: organizationId,
            invite_id: invite.invite_id,
            email: invite.email,
            status: invite.status,
          },
        });
        return sendJson(res, 200, invite);
      }
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return true;
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "入力が不正です",
      error.details || { failure_code: "validation_error" }
    );
  }
}

module.exports = {
  handleAdminRbac,
};
