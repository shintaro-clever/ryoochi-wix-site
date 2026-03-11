"use strict";

const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("./index");
const { withRetry } = require("./retry");
const { normalizeExecutionJob } = require("../types/executionJob");

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

function createExecutionJob({
  tenantId = DEFAULT_TENANT,
  payload = {},
  dbConn = db,
} = {}) {
  const normalized = normalizeExecutionJob({
    ...payload,
    tenant_id: payload.tenant_id || tenantId,
    execution_job_id: payload.execution_job_id || crypto.randomUUID(),
    created_at: payload.created_at || nowIso(),
    updated_at: payload.updated_at || nowIso(),
  });
  withRetry(() =>
    dbConn
      .prepare(
        `INSERT INTO execution_jobs(
          tenant_id,id,plan_id,project_id,created_by,status,job_type,target_scope_json,inputs_json,safety_level,confirm_state,plan_ref_json,run_ref_json,audit_draft_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        normalized.tenant_id,
        normalized.execution_job_id,
        normalized.plan_ref.plan_id,
        normalized.project_id,
        normalized.created_by,
        normalized.status,
        normalized.job_type,
        toJson(normalized.target_scope),
        toJson(normalized.inputs),
        normalized.safety_level,
        normalized.confirm_state,
        toJson(normalized.plan_ref),
        toJson(normalized.run_ref),
        toJson(normalized.audit_draft),
        normalized.created_at,
        normalized.updated_at
      )
  );
  return normalized;
}

function getExecutionJob({
  tenantId = DEFAULT_TENANT,
  executionJobId,
  dbConn = db,
} = {}) {
  const row = withRetry(() =>
    dbConn.prepare(
      `SELECT tenant_id,id,plan_id,project_id,created_by,status,job_type,target_scope_json,inputs_json,safety_level,confirm_state,plan_ref_json,run_ref_json,audit_draft_json,created_at,updated_at
       FROM execution_jobs
       WHERE tenant_id=? AND id=?
       LIMIT 1`
    ).get(tenantId, executionJobId)
  );
  if (!row) return null;
  return normalizeExecutionJob({
    execution_job_id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    created_by: row.created_by,
    status: row.status,
    job_type: row.job_type,
    target_scope: fromJson(row.target_scope_json, {}),
    inputs: fromJson(row.inputs_json, {}),
    safety_level: row.safety_level,
    confirm_state: row.confirm_state,
    plan_ref: fromJson(row.plan_ref_json, { plan_id: row.plan_id }),
    run_ref: fromJson(row.run_ref_json, {}),
    audit_draft: fromJson(row.audit_draft_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function listExecutionJobs({
  tenantId = DEFAULT_TENANT,
  projectId = "",
  planId = "",
  dbConn = db,
} = {}) {
  const hasProjectId = typeof projectId === "string" && projectId.trim();
  const hasPlanId = typeof planId === "string" && planId.trim();
  let sql = `SELECT tenant_id,id,plan_id,project_id,created_by,status,job_type,target_scope_json,inputs_json,safety_level,confirm_state,plan_ref_json,run_ref_json,audit_draft_json,created_at,updated_at
       FROM execution_jobs
       WHERE tenant_id=?`;
  const params = [tenantId];
  if (hasProjectId) {
    sql += ` AND project_id=?`;
    params.push(projectId.trim());
  }
  if (hasPlanId) {
    sql += ` AND plan_id=?`;
    params.push(planId.trim());
  }
  sql += ` ORDER BY created_at DESC`;
  const rows = withRetry(() => dbConn.prepare(sql).all(...params));
  return rows.map((row) =>
    normalizeExecutionJob({
      execution_job_id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      created_by: row.created_by,
      status: row.status,
      job_type: row.job_type,
      target_scope: fromJson(row.target_scope_json, {}),
      inputs: fromJson(row.inputs_json, {}),
      safety_level: row.safety_level,
      confirm_state: row.confirm_state,
      plan_ref: fromJson(row.plan_ref_json, { plan_id: row.plan_id }),
      run_ref: fromJson(row.run_ref_json, {}),
      audit_draft: fromJson(row.audit_draft_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  );
}

module.exports = {
  createExecutionJob,
  getExecutionJob,
  listExecutionJobs,
};
