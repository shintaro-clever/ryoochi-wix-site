"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { createWritePlan, getWritePlan, listWritePlans } = require("../../db/writePlans");
const { toWritePlanApi } = require("../writePlans");
const { toExecutionPlanApi } = require("../executionPlans");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseWritePlanId(urlPath) {
  const match = String(urlPath || "").match(/^\/api\/write-plans\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function listRelatedExecutionPlans(db, writePlan) {
  const rows = db.prepare(
    `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,plan_type,target_kind,target_refs_json,
            requested_by,proposed_by_ai,summary,expected_changes_json,evidence_refs_json,impact_scope_json,risk_level,
            confirm_required,plan_version,confirm_state,confirm_policy_json,confirm_session_json,rollback_plan_json,status,
            rejection_reason,approved_by,approved_at,internal_meta_json,created_at,updated_at
     FROM execution_plans
     WHERE tenant_id=? AND project_id=?
     ORDER BY updated_at DESC, created_at DESC`
  ).all(DEFAULT_TENANT, writePlan.project_id);
  return rows
    .map((row) => toExecutionPlanApi({
      plan_id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      thread_id: row.thread_id,
      run_id: row.run_id,
      source_type: row.source_type,
      source_ref: JSON.parse(row.source_ref_json || "{}"),
      plan_type: row.plan_type,
      target_kind: row.target_kind,
      target_refs: JSON.parse(row.target_refs_json || "[]"),
      requested_by: row.requested_by,
      proposed_by_ai: Number(row.proposed_by_ai || 0) === 1,
      summary: row.summary,
      expected_changes: JSON.parse(row.expected_changes_json || "[]"),
      evidence_refs: JSON.parse(row.evidence_refs_json || "{}"),
      impact_scope: JSON.parse(row.impact_scope_json || "{}"),
      risk_level: row.risk_level,
      confirm_required: Number(row.confirm_required || 0) === 1,
      plan_version: row.plan_version,
      confirm_state: row.confirm_state,
      confirm_policy: JSON.parse(row.confirm_policy_json || "{}"),
      confirm_session: JSON.parse(row.confirm_session_json || "{}"),
      rollback_plan: JSON.parse(row.rollback_plan_json || "{}"),
      status: row.status,
      rejection_reason: row.rejection_reason,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      internal_meta: JSON.parse(row.internal_meta_json || "{}"),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
    .filter((plan) => {
      return plan.source_ref && plan.source_ref.ref_kind === "write_plan" && plan.source_ref.ref_id === writePlan.write_plan_id;
    });
}

function getApprovalState(writePlan, relatedPlans) {
  const current = Array.isArray(relatedPlans) ? relatedPlans[0] : null;
  if (current && current.confirm_state === "rejected") return "rejected";
  if (current && (current.confirm_state === "approved" || current.confirm_state === "not_required")) return "approved";
  if (current && current.confirm_state === "revoked") return "revoked";
  if (current && current.confirm_state === "expired") return "expired";
  return writePlan.confirm_required ? "approval_pending" : "not_required";
}

function toWritePlanView(db, writePlan) {
  const relatedExecutionPlans = listRelatedExecutionPlans(db, writePlan);
  const currentExecutionPlan = relatedExecutionPlans[0] || null;
  return {
    ...toWritePlanApi(writePlan),
    approval_state: getApprovalState(writePlan, relatedExecutionPlans),
    related_execution_plan: currentExecutionPlan
      ? {
          plan_id: currentExecutionPlan.plan_id,
          confirm_state: currentExecutionPlan.confirm_state,
          status: currentExecutionPlan.status,
          rejection_reason: currentExecutionPlan.rejection_reason,
          approved_by: currentExecutionPlan.approved_by,
          approved_at: currentExecutionPlan.approved_at,
        }
      : null,
  };
}

function toTargetRefFromFile(pathname, targetKind) {
  const path = normalizeText(pathname).replace(/^\/+/, "");
  if (!path) return null;
  return {
    system: targetKind === "doc" ? "docs" : targetKind || "github",
    target_type: "file",
    id: null,
    path,
    name: path.split("/").pop() || path,
    scope: null,
    writable: true,
    metadata: {},
  };
}

function normalizeTargetRefsInput(body = {}) {
  const direct = asArray(body.target_refs).filter((entry) => entry && typeof entry === "object");
  if (direct.length > 0) return direct;
  return asArray(body.target_files)
    .map((item) => toTargetRefFromFile(item, normalizeText(body.target_kind) || "github"))
    .filter(Boolean);
}

function toWritePlanPayload(body = {}, actorId = "") {
  const projectId = normalizeText(body.project_id);
  if (!projectId) {
    const error = new Error("project_id is required");
    error.status = 400;
    throw error;
  }
  const targetRefs = normalizeTargetRefsInput(body);
  if (targetRefs.length === 0) {
    const error = new Error("target_refs or target_files is required");
    error.status = 400;
    throw error;
  }
  return {
    project_id: projectId,
    thread_id: normalizeText(body.thread_id) || null,
    run_id: normalizeText(body.run_id) || null,
    source_type: normalizeText(body.source_type) || "manual_request",
    source_ref: asObject(body.source_ref),
    target_kind: normalizeText(body.target_kind) || "mixed",
    target_refs: targetRefs,
    summary: normalizeText(body.summary) || null,
    expected_changes: asArray(body.expected_changes),
    evidence_refs: asObject(body.evidence_refs),
    confirm_required: body.confirm_required !== false,
    status: normalizeText(body.status) || "draft",
    created_by: actorId || normalizeText(body.created_by) || "user",
    internal_meta: asObject(body.internal_meta),
  };
}

async function handleWritePlans(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const url = new URL(req.url || "/", "http://localhost");
  const actorId = typeof req.user?.id === "string" && req.user.id.trim() ? req.user.id.trim() : "user";

  if (method === "POST" && url.pathname === "/api/write-plans") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    try {
      const writePlan = createWritePlan({
        tenantId: DEFAULT_TENANT,
        payload: toWritePlanPayload(body, actorId),
        dbConn: db,
      });
      return sendJson(res, 201, toWritePlanApi(writePlan));
    } catch (error) {
      return jsonError(res, error.status || 400, "VALIDATION_ERROR", error.message || "write plan create failed", {
        failure_code: "validation_error",
      });
    }
  }

  if (method === "GET") {
    if (url.pathname === "/api/write-plans") {
      const projectId = normalizeText(url.searchParams.get("project_id"));
      const approvalState = normalizeText(url.searchParams.get("approval_state"));
      const allItems = listWritePlans({ tenantId: DEFAULT_TENANT, projectId, dbConn: db })
        .map((plan) => toWritePlanView(db, plan));
      const items = allItems.filter((plan) => !approvalState || plan.approval_state === approvalState);
      return sendJson(res, 200, {
        items,
        counts: {
          all: allItems.length,
          approval_pending: allItems.filter((item) => item.approval_state === "approval_pending").length,
          rejected: allItems.filter((item) => item.approval_state === "rejected").length,
        },
      });
    }
    const writePlanId = parseWritePlanId(url.pathname);
    if (writePlanId) {
      const plan = getWritePlan({ tenantId: DEFAULT_TENANT, writePlanId, dbConn: db });
      if (!plan) return jsonError(res, 404, "NOT_FOUND", "write plan not found", { failure_code: "not_found" });
      return sendJson(res, 200, toWritePlanView(db, plan));
    }
  }

  return false;
}

module.exports = {
  handleWritePlans,
};
