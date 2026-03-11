"use strict";

const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("./index");
const { withRetry } = require("./retry");
const { normalizeWritePlan } = require("../types/writePlan");

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

function buildWritePlanRecord(input = {}, { tenantId = DEFAULT_TENANT } = {}) {
  const normalized = normalizeWritePlan({
    ...input,
    tenant_id: input.tenant_id || tenantId,
    write_plan_id: input.write_plan_id || crypto.randomUUID(),
    created_at: input.created_at || nowIso(),
    updated_at: input.updated_at || nowIso(),
  });
  return {
    tenant_id: normalized.tenant_id,
    id: normalized.write_plan_id,
    project_id: normalized.project_id,
    thread_id: normalized.thread_id,
    run_id: normalized.run_id,
    source_type: normalized.source_type,
    source_ref_json: toJson(normalized.source_ref),
    target_kind: normalized.target_kind,
    target_refs_json: JSON.stringify(normalized.target_refs),
    summary: normalized.summary,
    expected_changes_json: JSON.stringify(normalized.expected_changes),
    evidence_refs_json: JSON.stringify(normalized.evidence_refs),
    confirm_required: normalized.confirm_required ? 1 : 0,
    status: normalized.status,
    created_by: normalized.created_by,
    internal_meta_json: JSON.stringify(normalized.internal_meta),
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
  };
}

function mapWritePlanRow(row) {
  if (!row) return null;
  return normalizeWritePlan({
    write_plan_id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    thread_id: row.thread_id,
    run_id: row.run_id,
    source_type: row.source_type,
    source_ref: fromJson(row.source_ref_json, {}),
    target_kind: row.target_kind,
    target_refs: fromJson(row.target_refs_json, []),
    summary: row.summary,
    expected_changes: fromJson(row.expected_changes_json, []),
    evidence_refs: fromJson(row.evidence_refs_json, {}),
    confirm_required: Number(row.confirm_required || 0) === 1,
    status: row.status,
    created_by: row.created_by,
    internal_meta: fromJson(row.internal_meta_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function createWritePlan({
  tenantId = DEFAULT_TENANT,
  payload,
  dbConn = db,
} = {}) {
  const record = buildWritePlanRecord(payload, { tenantId });
  withRetry(() =>
    dbConn.prepare(
      `INSERT INTO write_plans(
        tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,target_kind,target_refs_json,summary,
        expected_changes_json,evidence_refs_json,confirm_required,status,created_by,internal_meta_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      record.tenant_id,
      record.id,
      record.project_id,
      record.thread_id,
      record.run_id,
      record.source_type,
      record.source_ref_json,
      record.target_kind,
      record.target_refs_json,
      record.summary,
      record.expected_changes_json,
      record.evidence_refs_json,
      record.confirm_required,
      record.status,
      record.created_by,
      record.internal_meta_json,
      record.created_at,
      record.updated_at
    )
  );
  return getWritePlan({ tenantId: record.tenant_id, writePlanId: record.id, dbConn });
}

function getWritePlan({
  tenantId = DEFAULT_TENANT,
  writePlanId,
  dbConn = db,
} = {}) {
  if (!writePlanId) {
    throw new Error("writePlanId is required");
  }
  const row = withRetry(() =>
    dbConn.prepare(
      `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,target_kind,target_refs_json,summary,
              expected_changes_json,evidence_refs_json,confirm_required,status,created_by,internal_meta_json,created_at,updated_at
       FROM write_plans
       WHERE tenant_id=? AND id=?
       LIMIT 1`
    ).get(tenantId, writePlanId)
  );
  return mapWritePlanRow(row);
}

function listWritePlans({
  tenantId = DEFAULT_TENANT,
  projectId = "",
  dbConn = db,
} = {}) {
  const hasProjectId = typeof projectId === "string" && projectId.trim();
  const rows = withRetry(() =>
    hasProjectId
      ? dbConn.prepare(
          `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,target_kind,target_refs_json,summary,
                  expected_changes_json,evidence_refs_json,confirm_required,status,created_by,internal_meta_json,created_at,updated_at
           FROM write_plans
           WHERE tenant_id=? AND project_id=?
           ORDER BY updated_at DESC, created_at DESC`
        ).all(tenantId, projectId.trim())
      : dbConn.prepare(
          `SELECT tenant_id,id,project_id,thread_id,run_id,source_type,source_ref_json,target_kind,target_refs_json,summary,
                  expected_changes_json,evidence_refs_json,confirm_required,status,created_by,internal_meta_json,created_at,updated_at
           FROM write_plans
           WHERE tenant_id=?
           ORDER BY updated_at DESC, created_at DESC`
        ).all(tenantId)
  );
  return rows.map(mapWritePlanRow).filter(Boolean);
}

module.exports = {
  createWritePlan,
  getWritePlan,
  listWritePlans,
};
