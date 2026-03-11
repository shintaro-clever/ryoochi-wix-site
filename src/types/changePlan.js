"use strict";

const SOURCE_TYPES = Object.freeze([
  "phase4_corrective_action",
  "phase5_ai_proposal",
  "phase6_governance_request",
  "manual_request",
  "run_artifact",
  "doc_change_request",
]);

const PLAN_TYPES = Object.freeze([
  "corrective_change",
  "content_update",
  "connector_change",
  "docs_update",
  "mixed_change",
]);

const TARGET_KINDS = Object.freeze(["github", "figma", "doc", "drive", "mixed"]);
const IMPACT_SCOPE_KINDS = Object.freeze([
  "account",
  "project",
  "org",
  "repo",
  "file",
  "frame",
  "component",
  "thread",
  "run",
  "document",
  "mixed",
]);
const RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeText(value);
  return allowed.includes(text) ? text : fallback;
}

function normalizeSourceRef(value) {
  const source = asObject(value);
  return {
    system: normalizeOptionalText(source.system),
    ref_kind: normalizeOptionalText(source.ref_kind),
    ref_id: normalizeOptionalText(source.ref_id),
    path: normalizeOptionalText(source.path),
    label: normalizeOptionalText(source.label),
    version: normalizeOptionalText(source.version),
    metadata: asObject(source.metadata),
  };
}

function normalizeTargetRef(value) {
  const target = asObject(value);
  return {
    system: normalizeOptionalText(target.system),
    target_type: normalizeOptionalText(target.target_type),
    id: normalizeOptionalText(target.id),
    path: normalizeOptionalText(target.path),
    name: normalizeOptionalText(target.name),
    scope: normalizeOptionalText(target.scope),
    writable: Boolean(target.writable),
    metadata: asObject(target.metadata),
  };
}

function normalizeTargetRefs(value) {
  return asArray(value).map(normalizeTargetRef).filter((entry) => {
    return entry.system || entry.target_type || entry.id || entry.path || entry.name;
  });
}

function normalizeExpectedChange(value) {
  const entry = asObject(value);
  return {
    change_type: normalizeOptionalText(entry.change_type),
    target_ref: normalizeTargetRef(entry.target_ref),
    summary: normalizeOptionalText(entry.summary),
    before_ref: normalizeSourceRef(entry.before_ref),
    after_ref: normalizeSourceRef(entry.after_ref),
    patch_hint: normalizeOptionalText(entry.patch_hint),
  };
}

function normalizeExpectedChanges(value) {
  return asArray(value).map(normalizeExpectedChange).filter((entry) => entry.change_type || entry.summary);
}

function normalizeRefList(value) {
  return asArray(value).map((entry) => normalizeSourceRef(entry)).filter((item) => {
    return item.system || item.ref_kind || item.ref_id || item.path || item.label;
  });
}

function normalizeEvidenceRefs(value) {
  const source = asObject(value);
  return {
    run_artifacts: normalizeRefList(source.run_artifacts),
    compare_results: normalizeRefList(source.compare_results),
    ai_summaries: normalizeRefList(source.ai_summaries),
    source_documents: normalizeRefList(source.source_documents),
    other_refs: normalizeRefList(source.other_refs),
  };
}

function normalizeImpactScope(value) {
  const source = asObject(value);
  const details = asArray(source.details)
    .map((entry) => {
      const item = asObject(entry);
      return {
        kind: normalizeEnum(item.kind, IMPACT_SCOPE_KINDS, "project"),
        ref: normalizeOptionalText(item.ref),
        summary: normalizeOptionalText(item.summary),
      };
    })
    .filter((entry) => entry.ref || entry.summary);
  return {
    scope: normalizeEnum(source.scope, IMPACT_SCOPE_KINDS, "project"),
    details,
  };
}

function normalizeConfirmApprover(value) {
  const entry = asObject(value);
  return {
    type: normalizeOptionalText(entry.type) || "user",
    actor_id: normalizeOptionalText(entry.actor_id),
    role: normalizeOptionalText(entry.role),
    label: normalizeOptionalText(entry.label),
  };
}

function normalizeConfirmView(value) {
  const entry = asObject(value);
  return {
    view_id: normalizeOptionalText(entry.view_id),
    label: normalizeOptionalText(entry.label),
    required: entry.required !== false,
  };
}

function normalizeApprovalCondition(value) {
  const entry = asObject(value);
  return {
    condition_id: normalizeOptionalText(entry.condition_id),
    summary: normalizeOptionalText(entry.summary),
    check_type: normalizeOptionalText(entry.check_type),
    details: asObject(entry.details),
  };
}

function normalizeConfirmPolicy(value, confirmRequired = true) {
  const source = asObject(value);
  return {
    mode: normalizeOptionalText(source.mode) || (confirmRequired ? "explicit_confirm" : "view_only"),
    required_approvers: asArray(source.required_approvers)
      .map(normalizeConfirmApprover)
      .filter((entry) => entry.actor_id || entry.role || entry.label),
    required_views: asArray(source.required_views).map(normalizeConfirmView).filter((entry) => entry.view_id || entry.label),
    approval_conditions: asArray(source.approval_conditions)
      .map(normalizeApprovalCondition)
      .filter((entry) => entry.condition_id || entry.summary || entry.check_type),
    notes: normalizeOptionalText(source.notes),
  };
}

function normalizeRollbackStep(value) {
  const entry = asObject(value);
  return {
    step: normalizeOptionalText(entry.step),
    target_ref: normalizeTargetRef(entry.target_ref),
    notes: normalizeOptionalText(entry.notes),
  };
}

function normalizeRollbackPrecondition(value) {
  const entry = asObject(value);
  return {
    summary: normalizeOptionalText(entry.summary),
    required: entry.required !== false,
  };
}

function normalizeRollbackPlan(value) {
  const source = asObject(value);
  return {
    rollback_type: normalizeOptionalText(source.rollback_type) || "manual_restore",
    rollback_steps: asArray(source.rollback_steps).map(normalizeRollbackStep).filter((entry) => entry.step),
    rollback_preconditions: asArray(source.rollback_preconditions)
      .map(normalizeRollbackPrecondition)
      .filter((entry) => entry.summary),
  };
}

module.exports = {
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
  normalizeTargetRef,
  normalizeTargetRefs,
  normalizeExpectedChanges,
  normalizeEvidenceRefs,
  normalizeImpactScope,
  normalizeConfirmPolicy,
  normalizeRollbackPlan,
};
