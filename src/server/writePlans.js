"use strict";

const { normalizeWritePlan } = require("../types/writePlan");

function toWritePlanApi(plan) {
  const normalized = normalizeWritePlan(plan || {});
  const targetFiles = normalized.target_refs
    .map((entry) => (entry && typeof entry.path === "string" ? entry.path.trim() : ""))
    .filter(Boolean);
  return {
    write_plan_id: normalized.write_plan_id,
    tenant_id: normalized.tenant_id,
    project_id: normalized.project_id,
    thread_id: normalized.thread_id,
    run_id: normalized.run_id,
    source_type: normalized.source_type,
    source_ref: normalized.source_ref,
    target_kind: normalized.target_kind,
    target_refs: normalized.target_refs,
    target_files: targetFiles,
    summary: normalized.summary,
    expected_changes: normalized.expected_changes,
    evidence_refs: normalized.evidence_refs,
    confirm_required: normalized.confirm_required,
    status: normalized.status,
    created_by: normalized.created_by,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
  };
}

module.exports = {
  toWritePlanApi,
};
