"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { getExecutionPlan, setExecutionPlanState } = require("../../db/executionPlans");
const { createExecutionJob, getExecutionJob, listExecutionJobs } = require("../../db/executionJobs");
const { createAuditEventDraft, commitLatestAuditDraft } = require("../../db/auditEventDrafts");
const { toExecutionJobApi } = require("../executionJobs");
const { recordAudit, AUDIT_ACTIONS } = require("../../middleware/audit");

function buildAuditDraft(plan, actorId) {
  return {
    draft_event_type: "execution_job.confirmed_ready",
    draft_state: "drafted",
    commit_condition: "execution job must move from queued/running to succeeded or failed before audit event is committed",
    actor_id: actorId,
    plan_id: plan.plan_id,
    project_id: plan.project_id,
    approved_by: plan.approved_by,
    approved_at: plan.approved_at,
    summary: plan.summary,
    target_refs: plan.target_refs,
    impact_scope: plan.impact_scope,
    expected_changes: plan.expected_changes,
    rollback_plan: plan.rollback_plan,
    evidence_refs: plan.evidence_refs,
    risk_level: plan.risk_level,
  };
}

function mapSafetyLevel(riskLevel) {
  const level = String(riskLevel || "").trim().toLowerCase();
  if (level === "critical") return "critical";
  if (level === "high") return "elevated";
  return "guarded";
}

function deriveJobType(plan) {
  const planType = String(plan && plan.plan_type || "").trim();
  if (planType) return `${planType}_job`;
  return "planned_change_execution";
}

function buildExecutionJobPayload(plan, actorId) {
  return {
    project_id: plan.project_id,
    created_by: actorId,
    status: "queued",
    job_type: deriveJobType(plan),
    target_scope: {
      target_kind: plan.target_kind,
      impact_scope: plan.impact_scope,
      target_refs: plan.target_refs,
    },
    inputs: {
      summary: plan.summary,
      expected_changes: plan.expected_changes,
      rollback_plan: plan.rollback_plan,
      evidence_refs: plan.evidence_refs,
    },
    safety_level: mapSafetyLevel(plan.risk_level),
    confirm_state: plan.confirm_state,
    plan_ref: {
      plan_id: plan.plan_id,
      current_plan_version: plan.plan_version,
      confirm_state: plan.confirm_state,
      source_type: plan.source_type,
      source_ref: plan.source_ref,
    },
    run_ref: {
      run_id: plan.run_id,
      thread_id: plan.thread_id,
      project_id: plan.project_id,
    },
    audit_draft: buildAuditDraft(plan, actorId),
  };
}

function parseExecutionJobPath(urlPath) {
  const match = String(urlPath || "").match(/^\/api\/execution-jobs(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  return match ? { executionJobId: match[1] || "", action: match[2] || "" } : null;
}

async function handleExecutionJobs(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const url = new URL(req.url || "/", "http://localhost");
  const matched = parseExecutionJobPath(url.pathname);
  if (!matched) return false;

  if (method === "GET" && !matched.executionJobId) {
    const projectId = typeof url.searchParams.get("project_id") === "string" ? url.searchParams.get("project_id").trim() : "";
    const planId = typeof url.searchParams.get("plan_id") === "string" ? url.searchParams.get("plan_id").trim() : "";
    const jobs = listExecutionJobs({
      tenantId: DEFAULT_TENANT,
      projectId,
      planId,
      dbConn: db,
    });
    return sendJson(res, 200, {
      items: jobs.map(toExecutionJobApi),
      total: jobs.length,
    });
  }

  if (method === "GET" && matched.executionJobId && !matched.action) {
    const job = getExecutionJob({ tenantId: DEFAULT_TENANT, executionJobId: matched.executionJobId, dbConn: db });
    if (!job) {
      return jsonError(res, 404, "NOT_FOUND", "execution job not found", { failure_code: "not_found" });
    }
    return sendJson(res, 200, toExecutionJobApi(job));
  }

  if (method === "GET" && matched.executionJobId && matched.action === "status") {
    const job = getExecutionJob({ tenantId: DEFAULT_TENANT, executionJobId: matched.executionJobId, dbConn: db });
    if (!job) {
      return jsonError(res, 404, "NOT_FOUND", "execution job not found", { failure_code: "not_found" });
    }
    return sendJson(res, 200, {
      execution_job_id: job.execution_job_id,
      status: job.status,
      confirm_state: job.confirm_state,
      safety_level: job.safety_level,
      plan_ref: job.plan_ref,
      updated_at: job.updated_at,
    });
  }

  if (method === "PATCH" && matched.executionJobId && !matched.action) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
    }
    const job = getExecutionJob({ tenantId: DEFAULT_TENANT, executionJobId: matched.executionJobId, dbConn: db });
    if (!job) {
      return jsonError(res, 404, "NOT_FOUND", "execution job not found", { failure_code: "not_found" });
    }
    const nextStatus = typeof body.status === "string" ? body.status.trim() : "";
    if (!["running", "succeeded", "failed", "cancelled"].includes(nextStatus)) {
      return jsonError(res, 400, "VALIDATION_ERROR", "status is invalid", { failure_code: "validation_error" });
    }
    const ts = new Date().toISOString();
    db.prepare("UPDATE execution_jobs SET status=?, updated_at=? WHERE tenant_id=? AND id=?").run(
      nextStatus,
      ts,
      DEFAULT_TENANT,
      matched.executionJobId
    );
    const current = getExecutionJob({ tenantId: DEFAULT_TENANT, executionJobId: matched.executionJobId, dbConn: db });
    const actorId = typeof req.user?.id === "string" && req.user.id.trim() ? req.user.id.trim() : "user";
    if (nextStatus === "running") {
      recordAudit({
        db,
        action: AUDIT_ACTIONS.EXECUTION_JOB_STARTED,
        tenantId: DEFAULT_TENANT,
        actorId,
        meta: { execution_job_id: current.execution_job_id, plan_id: current.plan_ref.plan_id, project_id: current.project_id },
      });
      createAuditEventDraft({
        tenantId: DEFAULT_TENANT,
        entityType: "execution_job",
        entityId: current.execution_job_id,
        eventType: "job.started",
        draftState: "committed",
        commitCondition: "committed immediately when execution starts",
        committedAt: ts,
        meta: { execution_job_id: current.execution_job_id, plan_id: current.plan_ref.plan_id, project_id: current.project_id },
        dbConn: db,
      });
    }
    if (nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "cancelled") {
      recordAudit({
        db,
        action: AUDIT_ACTIONS.EXECUTION_JOB_FINISHED,
        tenantId: DEFAULT_TENANT,
        actorId,
        meta: { execution_job_id: current.execution_job_id, plan_id: current.plan_ref.plan_id, project_id: current.project_id, status: nextStatus },
      });
      createAuditEventDraft({
        tenantId: DEFAULT_TENANT,
        entityType: "execution_job",
        entityId: current.execution_job_id,
        eventType: "job.finished",
        draftState: "committed",
        commitCondition: "committed immediately when execution reaches a terminal state",
        committedAt: ts,
        meta: { execution_job_id: current.execution_job_id, plan_id: current.plan_ref.plan_id, project_id: current.project_id, status: nextStatus },
        dbConn: db,
      });
      commitLatestAuditDraft({
        tenantId: DEFAULT_TENANT,
        entityType: "execution_job",
        entityId: current.execution_job_id,
        eventType: "job.created",
        dbConn: db,
      });
    }
    return sendJson(res, 200, toExecutionJobApi(current));
  }

  if (method !== "POST" || matched.executionJobId) {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return true;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }
  const planId = typeof body.plan_id === "string" ? body.plan_id.trim() : "";
  if (!planId) {
    return jsonError(res, 400, "VALIDATION_ERROR", "plan_id is required", { failure_code: "validation_error" });
  }
  const plan = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId, dbConn: db });
  if (!plan) {
    return jsonError(res, 404, "NOT_FOUND", "execution plan not found", { failure_code: "not_found" });
  }
  if (plan.confirm_state !== "approved") {
    return jsonError(res, 409, "VALIDATION_ERROR", "execution job requires approved plan", {
      failure_code: "confirm_state_not_approved",
      confirm_state: plan.confirm_state,
    });
  }
  const actorId = typeof req.user?.id === "string" && req.user.id.trim() ? req.user.id.trim() : "user";
  const job = createExecutionJob({
    tenantId: DEFAULT_TENANT,
    payload: buildExecutionJobPayload(plan, actorId),
    dbConn: db,
  });
  setExecutionPlanState({
    tenantId: DEFAULT_TENANT,
    planId: plan.plan_id,
    patch: { status: "converted_to_job", internal_meta: { ...plan.internal_meta, latest_execution_job_id: job.execution_job_id } },
    dbConn: db,
  });
  recordAudit({
    db,
    action: AUDIT_ACTIONS.EXECUTION_JOB_CREATED,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { plan_id: plan.plan_id, execution_job_id: job.execution_job_id, project_id: plan.project_id },
  });
  createAuditEventDraft({
    tenantId: DEFAULT_TENANT,
    entityType: "execution_job",
    entityId: job.execution_job_id,
    eventType: "job.created",
    draftState: "draft",
    commitCondition: "commit when execution job reaches succeeded, failed, or cancelled",
    meta: { execution_job_id: job.execution_job_id, plan_id: plan.plan_id, project_id: plan.project_id },
    dbConn: db,
  });
  return sendJson(res, 201, toExecutionJobApi(job));
}

module.exports = {
  handleExecutionJobs,
};
