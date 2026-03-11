"use strict";

const {
  SOURCE_TYPES,
  TARGET_KINDS,
  nowIso,
  normalizeText,
  normalizeOptionalText,
  asObject,
  normalizeEnum,
  normalizeSourceRef,
  normalizeTargetRefs,
  normalizeExpectedChanges,
  normalizeEvidenceRefs,
} = require("./changePlan");

const WRITE_PLAN_STATUSES = Object.freeze([
  "draft",
  "ready",
  "superseded",
  "archived",
  "converted_to_execution_plan",
]);

function normalizeWritePlan(value = {}) {
  const source = asObject(value);
  const createdAt = normalizeOptionalText(source.created_at) || nowIso();
  const updatedAt = normalizeOptionalText(source.updated_at) || createdAt;
  return {
    write_plan_id: normalizeText(source.write_plan_id),
    tenant_id: normalizeText(source.tenant_id),
    project_id: normalizeText(source.project_id),
    thread_id: normalizeOptionalText(source.thread_id),
    run_id: normalizeOptionalText(source.run_id),
    source_type: normalizeEnum(source.source_type, SOURCE_TYPES, "manual_request"),
    source_ref: normalizeSourceRef(source.source_ref),
    target_kind: normalizeEnum(source.target_kind, TARGET_KINDS, "mixed"),
    target_refs: normalizeTargetRefs(source.target_refs),
    summary: normalizeOptionalText(source.summary),
    expected_changes: normalizeExpectedChanges(source.expected_changes),
    evidence_refs: normalizeEvidenceRefs(source.evidence_refs),
    confirm_required: source.confirm_required !== false,
    status: normalizeEnum(source.status, WRITE_PLAN_STATUSES, "draft"),
    created_by: normalizeOptionalText(source.created_by),
    created_at: createdAt,
    updated_at: updatedAt,
    internal_meta: asObject(source.internal_meta),
  };
}

module.exports = {
  WRITE_PLAN_STATUSES,
  normalizeWritePlan,
};
