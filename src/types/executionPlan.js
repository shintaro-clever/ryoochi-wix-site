"use strict";

const {
  SOURCE_TYPES,
  PLAN_TYPES,
  TARGET_KINDS,
  IMPACT_SCOPE_KINDS,
  RISK_LEVELS,
  nowIso,
  normalizeText,
  normalizeOptionalText,
  asObject,
  asArray,
  normalizeEnum,
  normalizeSourceRef,
  normalizeTargetRefs,
  normalizeExpectedChanges,
  normalizeEvidenceRefs,
  normalizeImpactScope,
  normalizeConfirmPolicy,
  normalizeRollbackPlan,
} = require("./changePlan");
const PLAN_STATUSES = Object.freeze([
  "draft",
  "confirm_pending",
  "approved",
  "rejected",
  "cancelled",
  "superseded",
  "converted_to_job",
]);
const CONFIRM_STATES = Object.freeze(["pending", "approved", "rejected", "expired", "revoked", "not_required"]);

function normalizeConfirmSession(value) {
  const source = asObject(value);
  return {
    plan_id: normalizeOptionalText(source.plan_id),
    tenant_id: normalizeOptionalText(source.tenant_id),
    project_id: normalizeOptionalText(source.project_id),
    actor_id: normalizeOptionalText(source.actor_id),
    issued_at: normalizeOptionalText(source.issued_at),
    expires_at: normalizeOptionalText(source.expires_at),
    confirm_hash: normalizeOptionalText(source.confirm_hash),
    current_plan_version: Number.isFinite(Number(source.current_plan_version)) ? Number(source.current_plan_version) : 1,
    state: normalizeOptionalText(source.state) || "issued",
    consumed_at: normalizeOptionalText(source.consumed_at),
  };
}

function normalizeExecutionPlan(value = {}) {
  const source = asObject(value);
  const confirmRequired = source.confirm_required !== false;
  const createdAt = normalizeOptionalText(source.created_at) || nowIso();
  const updatedAt = normalizeOptionalText(source.updated_at) || createdAt;
  const planVersion = Number.isFinite(Number(source.plan_version)) && Number(source.plan_version) > 0 ? Number(source.plan_version) : 1;
  const confirmState = normalizeEnum(
    source.confirm_state,
    CONFIRM_STATES,
    confirmRequired ? "pending" : "not_required"
  );
  return {
    plan_id: normalizeText(source.plan_id),
    tenant_id: normalizeText(source.tenant_id),
    project_id: normalizeText(source.project_id),
    thread_id: normalizeOptionalText(source.thread_id),
    run_id: normalizeOptionalText(source.run_id),
    source_type: normalizeEnum(source.source_type, SOURCE_TYPES, "manual_request"),
    source_ref: normalizeSourceRef(source.source_ref),
    plan_type: normalizeEnum(source.plan_type, PLAN_TYPES, "mixed_change"),
    target_kind: normalizeEnum(source.target_kind, TARGET_KINDS, "mixed"),
    target_refs: normalizeTargetRefs(source.target_refs),
    requested_by: normalizeOptionalText(source.requested_by),
    proposed_by_ai: Boolean(source.proposed_by_ai),
    summary: normalizeOptionalText(source.summary),
    expected_changes: normalizeExpectedChanges(source.expected_changes),
    evidence_refs: normalizeEvidenceRefs(source.evidence_refs),
    impact_scope: normalizeImpactScope(source.impact_scope),
    risk_level: normalizeEnum(source.risk_level, RISK_LEVELS, "medium"),
    confirm_required: confirmRequired,
    plan_version: planVersion,
    confirm_state: confirmState,
    confirm_policy: normalizeConfirmPolicy(source.confirm_policy, confirmRequired),
    confirm_session: normalizeConfirmSession(source.confirm_session),
    rollback_plan: normalizeRollbackPlan(source.rollback_plan),
    status: normalizeEnum(source.status, PLAN_STATUSES, "draft"),
    rejection_reason: normalizeOptionalText(source.rejection_reason),
    approved_by: normalizeOptionalText(source.approved_by),
    approved_at: normalizeOptionalText(source.approved_at),
    created_at: createdAt,
    updated_at: updatedAt,
    internal_meta: asObject(source.internal_meta),
  };
}

module.exports = {
  SOURCE_TYPES,
  PLAN_TYPES,
  TARGET_KINDS,
  IMPACT_SCOPE_KINDS,
  RISK_LEVELS,
  PLAN_STATUSES,
  normalizeExecutionPlan,
  normalizeSourceRef,
  normalizeTargetRefs,
  normalizeEvidenceRefs,
  normalizeImpactScope,
  normalizeConfirmPolicy,
  normalizeRollbackPlan,
};
