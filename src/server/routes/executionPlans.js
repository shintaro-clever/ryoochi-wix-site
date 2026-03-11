"use strict";

const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { createExecutionPlan, getExecutionPlan, updateExecutionPlan, setExecutionPlanState } = require("../../db/executionPlans");
const { createAuditEventDraft } = require("../../db/auditEventDrafts");
const { toExecutionPlanApi } = require("../executionPlans");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");

const IMPORTANT_IMPACT_SCOPES = new Set(["account", "project", "org", "repo", "mixed", "document"]);
const IMPORTANT_RISK_LEVELS = new Set(["high", "critical"]);

function hashConfirmToken(rawToken, session) {
  return crypto
    .createHash("sha256")
    .update(
      [
        String(rawToken || ""),
        session.plan_id,
        session.tenant_id,
        session.project_id,
        session.actor_id,
        session.issued_at,
        session.expires_at,
        String(session.current_plan_version),
      ].join("|")
    )
    .digest("hex");
}

function parseExecutionPlanId(urlPath) {
  const match = String(urlPath || "").match(/^\/api\/execution-plans\/([^/]+)(?:\/([^/]+))?$/);
  return match ? { planId: decodeURIComponent(match[1]), action: match[2] || "" } : null;
}

function isImportantChange(payload = {}) {
  const riskLevel = typeof payload.risk_level === "string" ? payload.risk_level.trim().toLowerCase() : "";
  if (IMPORTANT_RISK_LEVELS.has(riskLevel)) return true;
  const scope = payload && payload.impact_scope && typeof payload.impact_scope.scope === "string"
    ? payload.impact_scope.scope.trim().toLowerCase()
    : "";
  if (IMPORTANT_IMPACT_SCOPES.has(scope)) return true;
  const details = payload && payload.impact_scope && Array.isArray(payload.impact_scope.details) ? payload.impact_scope.details : [];
  return details.some((entry) => IMPORTANT_IMPACT_SCOPES.has(String(entry && entry.kind || "").trim().toLowerCase()));
}

function toPlanPayload(body = {}, actorId = "") {
  const confirmRequired = body.confirm_required !== false;
  const important = isImportantChange(body);
  if (important && confirmRequired === false) {
    const error = new Error("important change must keep confirm_required=true");
    error.status = 400;
    error.details = { failure_code: "confirm_required_enforced", important_change: true };
    throw error;
  }
  const finalConfirmRequired = important ? true : confirmRequired;
  const initialConfirmState = finalConfirmRequired ? "pending" : "approved";
  return {
    ...body,
    requested_by: body.requested_by || actorId || "user",
    confirm_required: finalConfirmRequired,
    confirm_state: initialConfirmState,
    status: initialConfirmState === "approved" ? "approved" : "confirm_pending",
    plan_version: 1,
    internal_meta: {
      ...(body && body.internal_meta && typeof body.internal_meta === "object" ? body.internal_meta : {}),
      server_confirm_enforced: important,
    },
  };
}

function isApproverAuthorized(plan, actorId, actorRole) {
  const approvers = plan && plan.confirm_policy && Array.isArray(plan.confirm_policy.required_approvers)
    ? plan.confirm_policy.required_approvers
    : [];
  if (approvers.length === 0) return { ok: true };
  const matched = approvers.some((entry) => {
    if (entry && typeof entry.actor_id === "string" && entry.actor_id.trim() && entry.actor_id.trim() === actorId) return true;
    if (entry && typeof entry.role === "string" && entry.role.trim() && entry.role.trim() === actorRole) return true;
    return false;
  });
  if (!matched) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "approver role is not allowed", details: { failure_code: "approver_not_allowed" } };
  }
  if (plan.requested_by && plan.requested_by === actorId) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "self approval is not allowed", details: { failure_code: "self_approval_forbidden" } };
  }
  return { ok: true };
}

async function handleExecutionPlans(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const url = new URL(req.url || "/", "http://localhost");
  const matched = parseExecutionPlanId(url.pathname);
  const actorId = typeof req.user?.id === "string" && req.user.id.trim() ? req.user.id.trim() : "user";
  const actorRole = typeof req.user?.role === "string" && req.user.role.trim() ? req.user.role.trim() : "";

  if (!matched && url.pathname === "/api/execution-plans" && method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    try {
      if (!body || typeof body.project_id !== "string" || !body.project_id.trim()) {
        return jsonError(res, 400, "VALIDATION_ERROR", "project_id is required", { failure_code: "validation_error" });
      }
      const plan = createExecutionPlan({
        tenantId: DEFAULT_TENANT,
        payload: toPlanPayload(body, actorId),
        dbConn: db,
      });
      recordAudit({
        db,
        action: AUDIT_ACTIONS.EXECUTION_PLAN_CREATED,
        tenantId: DEFAULT_TENANT,
        actorId,
        meta: { plan_id: plan.plan_id, project_id: plan.project_id, confirm_required: plan.confirm_required, risk_level: plan.risk_level },
      });
      createAuditEventDraft({
        tenantId: DEFAULT_TENANT,
        entityType: "execution_plan",
        entityId: plan.plan_id,
        eventType: "plan.created",
        draftState: "committed",
        commitCondition: "committed immediately when the execution plan is created by the server",
        committedAt: new Date().toISOString(),
        meta: { plan_id: plan.plan_id, project_id: plan.project_id, confirm_required: plan.confirm_required, risk_level: plan.risk_level },
        dbConn: db,
      });
      return sendJson(res, 201, toExecutionPlanApi(plan));
    } catch (error) {
      return jsonError(res, error.status || 400, "VALIDATION_ERROR", error.message || "execution plan create failed", error.details || { failure_code: "validation_error" });
    }
  }

  if (!matched) return false;

  if (method === "GET" && !matched.action) {
    const plan = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId: matched.planId, dbConn: db });
    if (!plan) return jsonError(res, 404, "NOT_FOUND", "execution plan not found", { failure_code: "not_found" });
    return sendJson(res, 200, toExecutionPlanApi(plan));
  }

  if (method === "PATCH" && !matched.action) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    try {
      const current = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId: matched.planId, dbConn: db });
      if (!current) return jsonError(res, 404, "NOT_FOUND", "execution plan not found", { failure_code: "not_found" });
      const merged = { ...current, ...body, impact_scope: body.impact_scope || current.impact_scope, risk_level: body.risk_level || current.risk_level };
      if (isImportantChange(merged) && body.confirm_required === false) {
        return jsonError(res, 400, "VALIDATION_ERROR", "important change must keep confirm_required=true", {
          failure_code: "confirm_required_enforced",
        });
      }
      const updated = updateExecutionPlan({
        tenantId: DEFAULT_TENANT,
        planId: matched.planId,
        patch: { ...body, confirm_required: isImportantChange(merged) ? true : body.confirm_required },
        dbConn: db,
      });
      return sendJson(res, 200, toExecutionPlanApi(updated));
    } catch (error) {
      return jsonError(res, error.status || 400, "VALIDATION_ERROR", error.message || "execution plan update failed", error.details || { failure_code: "validation_error" });
    }
  }

  if (method === "POST" && matched.action === "confirm-session") {
    const plan = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId: matched.planId, dbConn: db });
    if (!plan) return jsonError(res, 404, "NOT_FOUND", "execution plan not found", { failure_code: "not_found" });
    if (!plan.confirm_required) return jsonError(res, 409, "VALIDATION_ERROR", "confirm is not required", { failure_code: "confirm_not_required" });

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const rawToken = crypto.randomBytes(24).toString("hex");
    const session = {
      plan_id: plan.plan_id,
      tenant_id: plan.tenant_id,
      project_id: plan.project_id,
      actor_id: actorId,
      issued_at: issuedAt,
      expires_at: expiresAt,
      current_plan_version: plan.plan_version,
      state: "issued",
      consumed_at: null,
    };
    session.confirm_hash = hashConfirmToken(rawToken, session);
    const next = setExecutionPlanState({
      tenantId: DEFAULT_TENANT,
      planId: plan.plan_id,
      patch: {
        confirm_state: "pending",
        status: "confirm_pending",
        confirm_session: session,
      },
      dbConn: db,
    });
    recordAudit({
      db,
      action: AUDIT_ACTIONS.EXECUTION_PLAN_CONFIRM_SESSION_ISSUED,
      tenantId: DEFAULT_TENANT,
      actorId,
      meta: { plan_id: plan.plan_id, project_id: plan.project_id, expires_at: expiresAt, plan_version: plan.plan_version },
    });
    return sendJson(res, 201, {
      ...toExecutionPlanApi(next),
      confirm_token: rawToken,
    });
  }

  if (method === "POST" && matched.action === "confirm") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    const plan = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId: matched.planId, dbConn: db });
    if (!plan) return jsonError(res, 404, "NOT_FOUND", "execution plan not found", { failure_code: "not_found" });
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    const session = plan.confirm_session || {};
    const patch = {
      confirm_session: {
        ...session,
        state: action,
        consumed_at: new Date().toISOString(),
      },
    };

    if (action === "revoke") {
      const revoked = setExecutionPlanState({
        tenantId: DEFAULT_TENANT,
        planId: plan.plan_id,
        patch: { ...patch, confirm_state: "revoked", status: "confirm_pending" },
        dbConn: db,
      });
      recordAudit({ db, action: AUDIT_ACTIONS.EXECUTION_PLAN_REVOKED, tenantId: DEFAULT_TENANT, actorId, meta: { plan_id: plan.plan_id } });
      return sendJson(res, 200, toExecutionPlanApi(revoked));
    }

    if (action === "expire") {
      const expired = setExecutionPlanState({
        tenantId: DEFAULT_TENANT,
        planId: plan.plan_id,
        patch: { ...patch, confirm_state: "expired", status: "confirm_pending" },
        dbConn: db,
      });
      recordAudit({ db, action: AUDIT_ACTIONS.EXECUTION_PLAN_EXPIRED, tenantId: DEFAULT_TENANT, actorId, meta: { plan_id: plan.plan_id } });
      return sendJson(res, 200, toExecutionPlanApi(expired));
    }

    if (!session.confirm_hash) {
      return jsonError(res, 409, "VALIDATION_ERROR", "confirm session is missing", { failure_code: "confirm_session_missing" });
    }
    if (session.actor_id !== actorId) {
      return jsonError(res, 403, "FORBIDDEN", "confirm actor mismatch", { failure_code: "actor_mismatch" });
    }
    if (session.consumed_at) {
      return jsonError(res, 409, "VALIDATION_ERROR", "confirm token already used", { failure_code: "confirm_token_reused" });
    }
    if (session.current_plan_version !== plan.plan_version) {
      const mismatched = setExecutionPlanState({
        tenantId: DEFAULT_TENANT,
        planId: plan.plan_id,
        patch: { confirm_state: "expired", status: "confirm_pending", confirm_session: { ...session, state: "expired", consumed_at: new Date().toISOString() } },
        dbConn: db,
      });
      return jsonError(res, 409, "VALIDATION_ERROR", "plan version mismatch", {
        failure_code: "plan_version_mismatch",
        current_plan_version: mismatched.plan_version,
      });
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      const expired = setExecutionPlanState({
        tenantId: DEFAULT_TENANT,
        planId: plan.plan_id,
        patch: { confirm_state: "expired", status: "confirm_pending", confirm_session: { ...session, state: "expired", consumed_at: new Date().toISOString() } },
        dbConn: db,
      });
      recordAudit({ db, action: AUDIT_ACTIONS.EXECUTION_PLAN_EXPIRED, tenantId: DEFAULT_TENANT, actorId, meta: { plan_id: plan.plan_id } });
      return jsonError(res, 409, "VALIDATION_ERROR", "confirm token expired", {
        failure_code: "confirm_token_expired",
        confirm_state: expired.confirm_state,
      });
    }
    const rawToken = typeof body.confirm_token === "string" ? body.confirm_token.trim() : "";
    if (!rawToken || hashConfirmToken(rawToken, session) !== session.confirm_hash) {
      return jsonError(res, 400, "VALIDATION_ERROR", "confirm token mismatch", { failure_code: "confirm_token_mismatch" });
    }

    if (action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return jsonError(res, 400, "VALIDATION_ERROR", "rejection reason is required", { failure_code: "validation_error" });
      }
      const currentMeta = plan.internal_meta && typeof plan.internal_meta === "object" ? plan.internal_meta : {};
      const rejectionHistory = Array.isArray(currentMeta.rejection_history) ? currentMeta.rejection_history.slice() : [];
      rejectionHistory.push({
        rejected_plan_version: plan.plan_version,
        rejected_at: new Date().toISOString(),
        rejected_by: actorId,
        rejection_reason: reason,
      });
      const rejected = setExecutionPlanState({
        tenantId: DEFAULT_TENANT,
        planId: plan.plan_id,
        patch: {
          ...patch,
          confirm_state: "rejected",
          status: "rejected",
          rejection_reason: reason,
          approved_by: actorId,
          internal_meta: { ...currentMeta, rejection_history: rejectionHistory },
        },
        dbConn: db,
      });
      recordAudit({ db, action: AUDIT_ACTIONS.EXECUTION_PLAN_REJECTED, tenantId: DEFAULT_TENANT, actorId, meta: { plan_id: plan.plan_id, reason } });
      createAuditEventDraft({
        tenantId: DEFAULT_TENANT,
        entityType: "execution_plan",
        entityId: plan.plan_id,
        eventType: "plan.rejected",
        draftState: "committed",
        commitCondition: "committed immediately when the server records the rejection state",
        committedAt: new Date().toISOString(),
        meta: { plan_id: plan.plan_id, reason, plan_version: plan.plan_version },
        dbConn: db,
      });
      return sendJson(res, 200, toExecutionPlanApi(rejected));
    }

    if (action !== "approve") {
      return jsonError(res, 400, "VALIDATION_ERROR", "unsupported confirm action", { failure_code: "validation_error" });
    }
    const authorization = isApproverAuthorized(plan, actorId, actorRole);
    if (!authorization.ok) {
      return jsonError(
        res,
        authorization.status || 403,
        authorization.code || "FORBIDDEN",
        authorization.message || "approval forbidden",
        authorization.details || { failure_code: "permission" }
      );
    }

    const approved = setExecutionPlanState({
      tenantId: DEFAULT_TENANT,
      planId: plan.plan_id,
      patch: {
        ...patch,
        confirm_state: "approved",
        status: "approved",
        approved_by: actorId,
        approved_at: new Date().toISOString(),
      },
      dbConn: db,
    });
    recordAudit({ db, action: AUDIT_ACTIONS.EXECUTION_PLAN_APPROVED, tenantId: DEFAULT_TENANT, actorId, meta: { plan_id: plan.plan_id, plan_version: plan.plan_version } });
    createAuditEventDraft({
      tenantId: DEFAULT_TENANT,
      entityType: "execution_plan",
      entityId: plan.plan_id,
      eventType: "plan.approved",
      draftState: "committed",
      commitCondition: "committed immediately when the server records the approved state",
      committedAt: new Date().toISOString(),
      meta: { plan_id: plan.plan_id, plan_version: plan.plan_version, approved_by: actorId },
      dbConn: db,
    });
    return sendJson(res, 200, toExecutionPlanApi(approved));
  }

  return false;
}

module.exports = {
  handleExecutionPlans,
  isImportantChange,
};
