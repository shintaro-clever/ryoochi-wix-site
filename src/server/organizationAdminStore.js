const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db");

const MEMBER_STATUSES = Object.freeze(["active", "invited", "suspended", "removed"]);
const INVITE_STATUSES = Object.freeze(["pending", "accepted", "expired", "revoked"]);

const DEFAULT_ROLE_DEFS = Object.freeze([
  {
    key: "org_owner",
    name: "Org Owner",
    description: "Full organization administration.",
    permissions: [
      "organization.manage",
      "member.manage",
      "invite.manage",
      "role.assign",
      "project.view_all",
      "project.manage",
      "connection.manage",
      "ai_usage.manage",
      "language_policy.manage",
      "knowledge_source.manage",
      "audit.view",
      "audit.export",
    ],
  },
  {
    key: "org_admin",
    name: "Org Admin",
    description: "Organization settings and member administration.",
    permissions: [
      "organization.manage",
      "member.manage",
      "invite.manage",
      "role.assign",
      "project.view_all",
      "audit.view",
    ],
  },
  {
    key: "ops_admin",
    name: "Ops Admin",
    description: "Cross-project operations and connection lifecycle.",
    permissions: ["project.view_all", "project.manage", "connection.manage", "audit.view"],
  },
  {
    key: "ai_admin",
    name: "AI Admin",
    description: "AI usage and language policy management.",
    permissions: ["ai_usage.manage", "language_policy.manage", "audit.view"],
  },
  {
    key: "knowledge_admin",
    name: "Knowledge Admin",
    description: "FAQ and knowledge source policy management.",
    permissions: ["knowledge_source.manage", "audit.view"],
  },
  {
    key: "project_operator",
    name: "Project Operator",
    description: "Project-level operations without org policy changes.",
    permissions: ["project.view_all", "project.manage"],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only audit visibility.",
    permissions: ["audit.view", "audit.export"],
  },
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function parseJsonArray(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validationError(message, details = {}) {
  return {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details: { failure_code: "validation_error", ...details },
  };
}

function notFoundError(message = "organization not found") {
  return {
    status: 404,
    code: "NOT_FOUND",
    message,
    details: { failure_code: "not_found" },
  };
}

function validateOrganizationId(organizationId) {
  const id = normalizeText(organizationId);
  if (!id) {
    throw validationError("organization_id is required", { field: "organization_id" });
  }
  return id;
}

function validateRoleKey(value) {
  const key = normalizeText(value).toLowerCase();
  if (!key) throw validationError("role key is required", { field: "key" });
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) {
    throw validationError("role key is invalid", { field: "key" });
  }
  return key;
}

function validatePermissions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError("permissions must be a non-empty array", { field: "permissions" });
  }
  return Array.from(
    new Set(
      value.map((entry) => normalizeText(entry)).filter((entry) => /^[a-z][a-z0-9_.]{2,120}$/.test(entry))
    )
  );
}

function requireOrganization(db, organizationId, tenantId = DEFAULT_TENANT) {
  const row = db
    .prepare("SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE tenant_id=? AND id=? LIMIT 1")
    .get(tenantId, validateOrganizationId(organizationId));
  if (!row) {
    throw notFoundError("organization not found");
  }
  return row;
}

function listOrganizations(db, tenantId = DEFAULT_TENANT) {
  return db
    .prepare(
      `SELECT id, name, slug, status, created_at, updated_at
       FROM organizations
       WHERE tenant_id=?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(tenantId)
    .map((row) => ({
      organization_id: row.id,
      name: row.name,
      slug: normalizeOptionalText(row.slug),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
}

function ensureDefaultRoles(db, organizationId, tenantId = DEFAULT_TENANT) {
  requireOrganization(db, organizationId, tenantId);
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO organization_roles(
      tenant_id,id,organization_id,role_key,name,description,permissions_json,is_system,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`
  );
  DEFAULT_ROLE_DEFS.forEach((role) => {
    insert.run(
      tenantId,
      crypto.randomUUID(),
      organizationId,
      role.key,
      role.name,
      role.description,
      JSON.stringify(role.permissions),
      1,
      ts,
      ts
    );
  });
}

function mapRoleRow(row) {
  return {
    role_id: row.id,
    organization_id: row.organization_id,
    key: row.role_key,
    name: row.name,
    description: normalizeOptionalText(row.description),
    permissions: parseJsonArray(row.permissions_json),
    is_system: Number(row.is_system || 0) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listOrganizationRoles(db, organizationId, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  ensureDefaultRoles(db, orgId, tenantId);
  return db
    .prepare(
      `SELECT id, organization_id, role_key, name, description, permissions_json, is_system, created_at, updated_at
       FROM organization_roles
       WHERE tenant_id=? AND organization_id=?
       ORDER BY is_system DESC, role_key ASC`
    )
    .all(tenantId, orgId)
    .map(mapRoleRow);
}

function getRoleMap(db, organizationId, tenantId = DEFAULT_TENANT) {
  return new Map(listOrganizationRoles(db, organizationId, tenantId).map((role) => [role.role_id, role]));
}

function upsertOrganizationRole(db, organizationId, payload = {}, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  ensureDefaultRoles(db, orgId, tenantId);
  const key = validateRoleKey(payload.key);
  const name = normalizeText(payload.name);
  if (!name) throw validationError("name is required", { field: "name" });
  const permissions = validatePermissions(payload.permissions);
  const description = normalizeOptionalText(payload.description);
  const ts = nowIso();
  const current = db
    .prepare(
      `SELECT id
       FROM organization_roles
       WHERE tenant_id=? AND organization_id=? AND role_key=?
       LIMIT 1`
    )
    .get(tenantId, orgId, key);
  if (current) {
    db.prepare(
      `UPDATE organization_roles
       SET name=?, description=?, permissions_json=?, updated_at=?
       WHERE tenant_id=? AND organization_id=? AND id=?`
    ).run(name, description, JSON.stringify(permissions), ts, tenantId, orgId, current.id);
  } else {
    db.prepare(
      `INSERT INTO organization_roles(
        tenant_id,id,organization_id,role_key,name,description,permissions_json,is_system,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(tenantId, crypto.randomUUID(), orgId, key, name, description, JSON.stringify(permissions), 0, ts, ts);
  }
  return db
    .prepare(
      `SELECT id, organization_id, role_key, name, description, permissions_json, is_system, created_at, updated_at
       FROM organization_roles
       WHERE tenant_id=? AND organization_id=? AND role_key=?
       LIMIT 1`
    )
    .get(tenantId, orgId, key);
}

function mapMemberRow(row, roleMap) {
  const assignedRoleIds = parseJsonArray(row.assigned_roles_json);
  return {
    member_id: row.id,
    organization_id: row.organization_id,
    account_id: row.account_id,
    email: normalizeOptionalText(row.email),
    display_name: normalizeOptionalText(row.display_name),
    status: row.status,
    assigned_role_ids: assignedRoleIds,
    assigned_roles: assignedRoleIds.map((roleId) => roleMap.get(roleId)).filter(Boolean),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listOrganizationMembers(db, organizationId, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const roleMap = getRoleMap(db, orgId, tenantId);
  return db
    .prepare(
      `SELECT id, organization_id, account_id, email, display_name, status, assigned_roles_json, created_at, updated_at
       FROM organization_members
       WHERE tenant_id=? AND organization_id=?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(tenantId, orgId)
    .map((row) => mapMemberRow(row, roleMap));
}

function validateRoleIds(db, organizationId, roleIds, tenantId = DEFAULT_TENANT) {
  const ids = Array.isArray(roleIds) ? roleIds.map((entry) => normalizeText(entry)).filter(Boolean) : [];
  const roleMap = getRoleMap(db, organizationId, tenantId);
  ids.forEach((roleId) => {
    if (!roleMap.has(roleId)) {
      throw validationError("role_id is invalid for organization", { field: "role_ids", role_id: roleId });
    }
  });
  return Array.from(new Set(ids));
}

function createOrganization(db, payload = {}, tenantId = DEFAULT_TENANT) {
  const name = normalizeText(payload.name);
  if (!name) throw validationError("name is required", { field: "name" });
  const slug = normalizeOptionalText(payload.slug);
  const status = normalizeText(payload.status) || "active";
  const ts = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO organizations(tenant_id,id,name,slug,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run(tenantId, id, name, slug, status, ts, ts);
  ensureDefaultRoles(db, id, tenantId);
  return requireOrganization(db, id, tenantId);
}

function createOrganizationMember(db, organizationId, payload = {}, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const accountId = normalizeText(payload.account_id);
  if (!accountId) throw validationError("account_id is required", { field: "account_id" });
  const email = normalizeOptionalText(payload.email);
  const displayName = normalizeOptionalText(payload.display_name);
  const status = normalizeText(payload.status) || "active";
  if (!MEMBER_STATUSES.includes(status)) {
    throw validationError("member status is invalid", { field: "status" });
  }
  const roleIds = validateRoleIds(db, orgId, payload.role_ids || payload.assigned_role_ids || [], tenantId);
  const ts = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO organization_members(
      tenant_id,id,organization_id,account_id,email,display_name,status,assigned_roles_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(tenantId, id, orgId, accountId, email, displayName, status, JSON.stringify(roleIds), ts, ts);
  const roleMap = getRoleMap(db, orgId, tenantId);
  const row = db
    .prepare(
      `SELECT id, organization_id, account_id, email, display_name, status, assigned_roles_json, created_at, updated_at
       FROM organization_members
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  return mapMemberRow(row, roleMap);
}

function updateOrganizationMember(db, organizationId, memberId, payload = {}, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const id = normalizeText(memberId);
  if (!id) throw validationError("member_id is required", { field: "member_id" });
  const current = db
    .prepare(
      `SELECT id, organization_id, account_id, email, display_name, status, assigned_roles_json, created_at, updated_at
       FROM organization_members
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  if (!current) {
    throw notFoundError("member not found");
  }
  const nextStatus = payload.status === undefined ? current.status : normalizeText(payload.status);
  if (!MEMBER_STATUSES.includes(nextStatus)) {
    throw validationError("member status is invalid", { field: "status" });
  }
  const nextRoleIds =
    payload.role_ids === undefined && payload.assigned_role_ids === undefined
      ? parseJsonArray(current.assigned_roles_json)
      : validateRoleIds(db, orgId, payload.role_ids || payload.assigned_role_ids || [], tenantId);
  const nextDisplayName =
    payload.display_name === undefined ? normalizeOptionalText(current.display_name) : normalizeOptionalText(payload.display_name);
  const nextEmail = payload.email === undefined ? normalizeOptionalText(current.email) : normalizeOptionalText(payload.email);
  const ts = nowIso();
  db.prepare(
    `UPDATE organization_members
     SET email=?, display_name=?, status=?, assigned_roles_json=?, updated_at=?
     WHERE tenant_id=? AND organization_id=? AND id=?`
  ).run(nextEmail, nextDisplayName, nextStatus, JSON.stringify(nextRoleIds), ts, tenantId, orgId, id);
  const roleMap = getRoleMap(db, orgId, tenantId);
  const row = db
    .prepare(
      `SELECT id, organization_id, account_id, email, display_name, status, assigned_roles_json, created_at, updated_at
       FROM organization_members
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  return mapMemberRow(row, roleMap);
}

function mapInviteRow(row, roleMap) {
  const proposedRoleIds = parseJsonArray(row.proposed_roles_json);
  return {
    invite_id: row.id,
    organization_id: row.organization_id,
    email: row.email,
    account_id: normalizeOptionalText(row.account_id),
    invited_by: normalizeOptionalText(row.invited_by),
    proposed_role_ids: proposedRoleIds,
    proposed_roles: proposedRoleIds.map((roleId) => roleMap.get(roleId)).filter(Boolean),
    status: row.status,
    expires_at: normalizeOptionalText(row.expires_at),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listOrganizationInvites(db, organizationId, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const roleMap = getRoleMap(db, orgId, tenantId);
  return db
    .prepare(
      `SELECT id, organization_id, email, account_id, invited_by, proposed_roles_json, status, expires_at, created_at, updated_at
       FROM organization_invites
       WHERE tenant_id=? AND organization_id=?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(tenantId, orgId)
    .map((row) => mapInviteRow(row, roleMap));
}

function createOrganizationInvite(db, organizationId, payload = {}, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const email = normalizeText(payload.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw validationError("email is invalid", { field: "email" });
  }
  const accountId = normalizeOptionalText(payload.account_id);
  const invitedBy = normalizeOptionalText(payload.invited_by);
  const roleIds = validateRoleIds(db, orgId, payload.role_ids || payload.proposed_role_ids || [], tenantId);
  const expiresAt = normalizeOptionalText(payload.expires_at);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw validationError("expires_at is invalid", { field: "expires_at" });
  }
  const ts = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO organization_invites(
      tenant_id,id,organization_id,email,account_id,invited_by,proposed_roles_json,status,expires_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(tenantId, id, orgId, email, accountId, invitedBy, JSON.stringify(roleIds), "pending", expiresAt, ts, ts);
  const roleMap = getRoleMap(db, orgId, tenantId);
  const row = db
    .prepare(
      `SELECT id, organization_id, email, account_id, invited_by, proposed_roles_json, status, expires_at, created_at, updated_at
       FROM organization_invites
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  return mapInviteRow(row, roleMap);
}

function revokeOrganizationInvite(db, organizationId, inviteId, tenantId = DEFAULT_TENANT) {
  const orgId = validateOrganizationId(organizationId);
  requireOrganization(db, orgId, tenantId);
  const id = normalizeText(inviteId);
  if (!id) throw validationError("invite_id is required", { field: "invite_id" });
  const current = db
    .prepare(
      `SELECT id, organization_id, email, account_id, invited_by, proposed_roles_json, status, expires_at, created_at, updated_at
       FROM organization_invites
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  if (!current) {
    throw notFoundError("invite not found");
  }
  if (!INVITE_STATUSES.includes(current.status)) {
    throw validationError("invite status is invalid", { field: "status" });
  }
  const ts = nowIso();
  db.prepare(
    `UPDATE organization_invites
     SET status='revoked', updated_at=?
     WHERE tenant_id=? AND organization_id=? AND id=?`
  ).run(ts, tenantId, orgId, id);
  const roleMap = getRoleMap(db, orgId, tenantId);
  const row = db
    .prepare(
      `SELECT id, organization_id, email, account_id, invited_by, proposed_roles_json, status, expires_at, created_at, updated_at
       FROM organization_invites
       WHERE tenant_id=? AND organization_id=? AND id=?
       LIMIT 1`
    )
    .get(tenantId, orgId, id);
  return mapInviteRow(row, roleMap);
}

module.exports = {
  MEMBER_STATUSES,
  INVITE_STATUSES,
  createOrganization,
  createOrganizationInvite,
  createOrganizationMember,
  ensureDefaultRoles,
  listOrganizations,
  listOrganizationInvites,
  listOrganizationMembers,
  listOrganizationRoles,
  mapRoleRow,
  notFoundError,
  requireOrganization,
  revokeOrganizationInvite,
  upsertOrganizationRole,
  updateOrganizationMember,
  validationError,
};
