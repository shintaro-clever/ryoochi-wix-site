"use strict";

const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("./index");
const { withRetry } = require("./retry");
const { normalizeExecutionPlan } = require("../types/executionPlan");

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value || {});
}

function fromJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function clone(value, fallback) {
  return fromJson(JSON.stringify(value || fallback), fallback);
}

function buildExecutionPlanRecord(input = {}, { tenantId = DEFAULT_TENANT } = {}) {
  const normalized = normalizeExecutionPlan({
    ...input,
    tenant_id: input.tenant_id || tenantId,
    plan_id: input.plan_id || crypto.randomUUID(),
    created_at: input.created_at || nowIso(),
    updated_at: input.updated_at || nowIso(),
  });
  return {
    tenant_id: normalized.tenant_id,
    id: normalized.plan_id,
    project_id: normalized.project_id,
    thread_id: normalized.thread_id,
    run_id: normalized.run_id,
    source_type: normalized.source_type,
    source_ref_json: toJson(normalized.source_ref),
    plan_type: normalized.plan_type,
    target_kind: normalized.target_kind,
    target_refs_json: JSON.stringify(normalized.target_refs),
    requested_by: normalized.requested_by,
    proposed_by_ai: normalized.proposed_by_ai ? 1 : 0,
    summary: normalized.summary,
    expected_changes_json: JSON.stringify(normalized.expected_changes),
    evidence_refs_json: JSON.stringify(normalized.evidence_refs),
    impact_scope_json: JSON.stringify(normalized.impact_scope),
    risk_level: normalized.risk_level,
    confirm_required: normalized.confirm_required ? 1 : 0,
    plan_version: normalized.plan_version,
    confirm_state: normalized.confirm_state,
    confirm_policy_json: JSON.stringify(normalized.confirm_policy),
    confirm_session_json: normalized.confirm_session && normalized.confirm_session.confirm_hash
      ? JSON.stringify(normalized.confirm_session)
      : null,
    rollback_plan_json: JSON.stringify(normalized.rollback_plan),
    status: normalized.status,
    rejection_reason: normalized.rejection_reason,
    approved_by: normalized.approved_by,
    approved_at: normalized.approved_at,
    internal_meta_json: JSON.stringify(normalized.internal_meta),
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
  };
}

function mapExecutionPlanRow(row) {
  if (!row) return null;
  return normalizeExecutionPlan({
    plan_id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    thread_id: row.thread_id,
    run_id: row.run_id,
    source_type: row.source_type,
    source_ref: fromJson(row.source_ref_json, {}),
    plan_type: row.plan_type,
    target_kind: row.target_kind,
    target_refs: fromJson(row.target_refs_json, []),
    requested_by: row.requested_by,
    proposed_by_ai: Number(row.proposed_by_ai || 0) === 1,
    summary: row.summary,
    expected_changes: fromJson(row.expected_changes_json, []),
    evidence_refs: fromJson(row.evidence_refs_json, {}),
    impact_scope: fromJson(row.impact_scope_json, {}),
    risk_level: row.risk_level,
    confirm_required: Number(row.confirm_required || 0) === 1,
    plan_version: Number.isFinite(Number(row.plan_version)) ? Number(row.plan_version) : 1,
    confirm_state: row.confirm_state,
    confirm_policy: fromJson(row.confirm_policy_json, {}),
    confirm_session: fromJson(row.confirm_session_json, {}),
    rollback_plan: fromJson(row.rollback_plan_json, {}),
    status: row.status,
    rejection_reason: row.rejection_reason,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    internal_meta: fromJson(row.internal_meta_json, {}),
  });
}

function createExecutionPlan({
  tenantId = DEFAULT_TENANT,
  payload,
  dbConn = db,
} = {}) {
  const record = buildExecutionPlanRecord(payload, { tenantId });
  withRetry(() =>
    dbConn.prepare(
      `INSERT INTO execution_plans(
        tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,plan_type,target_kind,target_refs_json,
        requested_by,proposed_by_ai,summary,expected_changes_json,evidence_refs_json,impact_scope_json,risk_level,
        confirm_required,plan_version,confirm_state,confirm_policy_json,confirm_session_json,rollback_plan_json,status,
        rejection_reason,approved_by,approved_at,internal_meta_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      record.tenant_id,
      record.id,
      record.project_id,
      record.thread_id,
      record.run_id,
      record.source_type,
      record.source_ref_json,
      record.plan_type,
      record.target_kind,
      record.target_refs_json,
      record.requested_by,
      record.proposed_by_ai,
      record.summary,
      record.expected_changes_json,
      record.evidence_refs_json,
      record.impact_scope_json,
      record.risk_level,
      record.confirm_required,
      record.plan_version,
      record.confirm_state,
      record.confirm_policy_json,
      record.confirm_session_json,
      record.rollback_plan_json,
      record.status,
      record.rejection_reason,
      record.approved_by,
      record.approved_at,
      record.internal_meta_json,
      record.created_at,
      record.updated_at
    )
  );
  return getExecutionPlan({ tenantId: record.tenant_id, planId: record.id, dbConn });
}

function getExecutionPlan({
  tenantId = DEFAULT_TENANT,
  planId,
  dbConn = db,
} = {}) {
  if (!planId) {
    throw new Error("planId is required");
  }
  const row = withRetry(() =>
    dbConn.prepare(
      `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,plan_type,target_kind,target_refs_json,
              requested_by,proposed_by_ai,summary,expected_changes_json,evidence_refs_json,impact_scope_json,risk_level,
              confirm_required,plan_version,confirm_state,confirm_policy_json,confirm_session_json,rollback_plan_json,status,
              rejection_reason,approved_by,approved_at,internal_meta_json,created_at,updated_at
       FROM execution_plans
       WHERE tenant_id=? AND id=?
       LIMIT 1`
    ).get(tenantId, planId)
  );
  return mapExecutionPlanRow(row);
}

function summarizeChangedFields(previousPlan, nextPlan) {
  const changed = [];
  [
    "summary",
    "target_refs",
    "impact_scope",
    "expected_changes",
    "rollback_plan",
    "evidence_refs",
    "risk_level",
    "confirm_required",
  ].forEach((key) => {
    if (JSON.stringify(previousPlan[key]) !== JSON.stringify(nextPlan[key])) changed.push(key);
  });
  return changed;
}

function updateExecutionPlan({
  tenantId = DEFAULT_TENANT,
  planId,
  patch = {},
  dbConn = db,
} = {}) {
  const current = getExecutionPlan({ tenantId, planId, dbConn });
  if (!current) return null;
  const currentMeta = clone(current.internal_meta, {});
  const next = normalizeExecutionPlan({
    ...current,
    ...patch,
    tenant_id: tenantId,
    plan_id: planId,
    plan_version: current.plan_version + 1,
    confirm_session: {},
    approved_by: null,
    approved_at: null,
    confirm_state: current.confirm_required ? "pending" : "not_required",
    status: current.confirm_required ? "confirm_pending" : "approved",
    updated_at: nowIso(),
    internal_meta: currentMeta,
  });

  if (current.confirm_state === "rejected") {
    const rejectionHistory = Array.isArray(currentMeta.rejection_history) ? currentMeta.rejection_history.slice() : [];
    rejectionHistory.push({
      rejected_plan_version: current.plan_version,
      rejected_at: current.updated_at,
      rejected_by: current.approved_by || null,
      rejection_reason: current.rejection_reason || null,
    });
    next.internal_meta.rejection_history = rejectionHistory;
    next.internal_meta.latest_reproposal_diff = {
      from_plan_version: current.plan_version,
      to_plan_version: next.plan_version,
      changed_fields: summarizeChangedFields(current, next),
    };
    next.rejection_reason = null;
  }

  const record = buildExecutionPlanRecord(next, { tenantId });
  withRetry(() =>
    dbConn.prepare(
      `UPDATE execution_plans
          SET project_id=?, thread_id=?, run_id=?, source_type=?, source_ref_json=?, plan_type=?, target_kind=?, target_refs_json=?,
              requested_by=?, proposed_by_ai=?, summary=?, expected_changes_json=?, evidence_refs_json=?, impact_scope_json=?,
              risk_level=?, confirm_required=?, plan_version=?, confirm_state=?, confirm_policy_json=?, confirm_session_json=?,
              rollback_plan_json=?, status=?, rejection_reason=?, approved_by=?, approved_at=?, internal_meta_json=?, updated_at=?
        WHERE tenant_id=? AND id=?`
    ).run(
      record.project_id,
      record.thread_id,
      record.run_id,
      record.source_type,
      record.source_ref_json,
      record.plan_type,
      record.target_kind,
      record.target_refs_json,
      record.requested_by,
      record.proposed_by_ai,
      record.summary,
      record.expected_changes_json,
      record.evidence_refs_json,
      record.impact_scope_json,
      record.risk_level,
      record.confirm_required,
      record.plan_version,
      record.confirm_state,
      record.confirm_policy_json,
      record.confirm_session_json,
      record.rollback_plan_json,
      record.status,
      record.rejection_reason,
      record.approved_by,
      record.approved_at,
      record.internal_meta_json,
      record.updated_at,
      tenantId,
      planId
    )
  );
  return getExecutionPlan({ tenantId, planId, dbConn });
}

function setExecutionPlanState({
  tenantId = DEFAULT_TENANT,
  planId,
  patch = {},
  dbConn = db,
} = {}) {
  const current = getExecutionPlan({ tenantId, planId, dbConn });
  if (!current) return null;
  const next = normalizeExecutionPlan({
    ...current,
    ...patch,
    tenant_id: tenantId,
    plan_id: planId,
    updated_at: patch.updated_at || nowIso(),
  });
  const record = buildExecutionPlanRecord(next, { tenantId });
  withRetry(() =>
    dbConn.prepare(
      `UPDATE execution_plans
          SET confirm_state=?, confirm_session_json=?, status=?, rejection_reason=?, approved_by=?, approved_at=?, internal_meta_json=?, updated_at=?
        WHERE tenant_id=? AND id=?`
    ).run(
      record.confirm_state,
      record.confirm_session_json,
      record.status,
      record.rejection_reason,
      record.approved_by,
      record.approved_at,
      record.internal_meta_json,
      record.updated_at,
      tenantId,
      planId
    )
  );
  return getExecutionPlan({ tenantId, planId, dbConn });
}

function listExecutionPlans({
  tenantId = DEFAULT_TENANT,
  projectId = "",
  status = "",
  confirmState = "",
  dbConn = db,
  limit = 100,
} = {}) {
  const hasProjectId = typeof projectId === "string" && projectId.trim();
  const hasStatus = typeof status === "string" && status.trim();
  const hasConfirmState = typeof confirmState === "string" && confirmState.trim();
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  let sql = `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,plan_type,target_kind,target_refs_json,
                    requested_by,proposed_by_ai,summary,expected_changes_json,evidence_refs_json,impact_scope_json,risk_level,
                    confirm_required,plan_version,confirm_state,confirm_policy_json,confirm_session_json,rollback_plan_json,status,
                    rejection_reason,approved_by,approved_at,internal_meta_json,created_at,updated_at
             FROM execution_plans
             WHERE tenant_id=?`;
  const params = [tenantId];
  if (hasProjectId) {
    sql += ` AND project_id=?`;
    params.push(projectId.trim());
  }
  if (hasStatus) {
    sql += ` AND status=?`;
    params.push(status.trim());
  }
  if (hasConfirmState) {
    sql += ` AND confirm_state=?`;
    params.push(confirmState.trim());
  }
  sql += ` ORDER BY updated_at DESC, created_at DESC LIMIT ?`;
  params.push(boundedLimit);
  const rows = withRetry(() => dbConn.prepare(sql).all(...params));
  return rows.map(mapExecutionPlanRow);
}

module.exports = {
  buildExecutionPlanRecord,
  mapExecutionPlanRow,
  createExecutionPlan,
  getExecutionPlan,
  listExecutionPlans,
  updateExecutionPlan,
  setExecutionPlanState,
};
