"use strict";

const { normalizeExecutionPlan } = require("../types/executionPlan");

function toExecutionPlanApi(plan) {
  const normalized = normalizeExecutionPlan(plan || {});
  return {
    plan_id: normalized.plan_id,
    tenant_id: normalized.tenant_id,
    project_id: normalized.project_id,
    thread_id: normalized.thread_id,
    run_id: normalized.run_id,
    source_type: normalized.source_type,
    source_ref: normalized.source_ref,
    plan_type: normalized.plan_type,
    target_kind: normalized.target_kind,
    target_refs: normalized.target_refs,
    requested_by: normalized.requested_by,
    proposed_by_ai: normalized.proposed_by_ai,
    summary: normalized.summary,
    expected_changes: normalized.expected_changes,
    evidence_refs: normalized.evidence_refs,
    impact_scope: normalized.impact_scope,
    risk_level: normalized.risk_level,
    confirm_required: normalized.confirm_required,
    plan_version: normalized.plan_version,
    confirm_state: normalized.confirm_state,
    confirm_policy: normalized.confirm_policy,
    confirm_session: {
      actor_id: normalized.confirm_session.actor_id,
      issued_at: normalized.confirm_session.issued_at,
      expires_at: normalized.confirm_session.expires_at,
      current_plan_version: normalized.confirm_session.current_plan_version,
      state: normalized.confirm_session.state,
      consumed_at: normalized.confirm_session.consumed_at,
    },
    rollback_plan: normalized.rollback_plan,
    status: normalized.status,
    rejection_reason: normalized.rejection_reason,
    approved_by: normalized.approved_by,
    approved_at: normalized.approved_at,
    rejection_history: Array.isArray(normalized.internal_meta.rejection_history) ? normalized.internal_meta.rejection_history : [],
    reproposal_diff: normalized.internal_meta.latest_reproposal_diff || null,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
  };
}

module.exports = {
  toExecutionPlanApi,
};
