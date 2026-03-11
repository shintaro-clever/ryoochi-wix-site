"use strict";

const { nowIso, normalizeText, normalizeOptionalText, asObject, asArray } = require("./changePlan");

const JOB_STATUSES = Object.freeze(["queued", "running", "succeeded", "failed", "cancelled"]);
const SAFETY_LEVELS = Object.freeze(["guarded", "elevated", "critical"]);

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeText(value);
  return allowed.includes(text) ? text : fallback;
}

function normalizeTargetScope(value) {
  const source = asObject(value);
  return {
    target_kind: normalizeOptionalText(source.target_kind),
    impact_scope: asObject(source.impact_scope),
    target_refs: asArray(source.target_refs),
  };
}

function normalizePlanRef(value) {
  const source = asObject(value);
  return {
    plan_id: normalizeOptionalText(source.plan_id),
    current_plan_version: Number.isFinite(Number(source.current_plan_version)) ? Number(source.current_plan_version) : 1,
    confirm_state: normalizeOptionalText(source.confirm_state) || "pending",
    source_type: normalizeOptionalText(source.source_type),
    source_ref: asObject(source.source_ref),
  };
}

function normalizeRunRef(value) {
  const source = asObject(value);
  return {
    run_id: normalizeOptionalText(source.run_id),
    thread_id: normalizeOptionalText(source.thread_id),
    project_id: normalizeOptionalText(source.project_id),
  };
}

function normalizeExecutionJob(value = {}) {
  const source = asObject(value);
  const createdAt = normalizeOptionalText(source.created_at) || nowIso();
  const updatedAt = normalizeOptionalText(source.updated_at) || createdAt;
  return {
    execution_job_id: normalizeText(source.execution_job_id),
    tenant_id: normalizeText(source.tenant_id),
    project_id: normalizeText(source.project_id),
    created_by: normalizeOptionalText(source.created_by),
    status: normalizeEnum(source.status, JOB_STATUSES, "queued"),
    job_type: normalizeOptionalText(source.job_type) || "planned_change_execution",
    target_scope: normalizeTargetScope(source.target_scope),
    inputs: asObject(source.inputs),
    safety_level: normalizeEnum(source.safety_level, SAFETY_LEVELS, "guarded"),
    confirm_state: normalizeOptionalText(source.confirm_state) || "pending",
    plan_ref: normalizePlanRef(source.plan_ref),
    run_ref: normalizeRunRef(source.run_ref),
    audit_draft: asObject(source.audit_draft),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

module.exports = {
  JOB_STATUSES,
  SAFETY_LEVELS,
  normalizeExecutionJob,
};
