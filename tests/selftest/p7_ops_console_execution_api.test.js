"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createExecutionPlan } = require("../../src/db/executionPlans");
const { createExecutionJob } = require("../../src/db/executionJobs");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdPlanIds = [];
  const createdJobIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "p7-ops-console", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    createdProjectIds.push(project.id.replace(/^project_/, ""));

    const confirmWaitingPlan = createExecutionPlan({
      tenantId: DEFAULT_TENANT,
      payload: {
        project_id: project.id,
        source_type: "manual_request",
        plan_type: "github_patch",
        target_kind: "github",
        target_refs: [{ system: "github", target_type: "file", path: "src/confirm.js", writable: true }],
        requested_by: "requester-a",
        summary: "Confirm waiting plan",
        expected_changes: [{ change_type: "update", summary: "confirm pending file" }],
        evidence_refs: { other_refs: [{ system: "hub", ref_kind: "ticket", ref_id: "ops-1" }] },
        impact_scope: { scope: "project", details: [{ kind: "file", ref: "src/confirm.js", summary: "single file" }] },
        risk_level: "high",
        confirm_required: true,
        confirm_state: "pending",
        rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert commit" }] },
        status: "confirm_pending",
      },
      dbConn: db,
    });
    createdPlanIds.push(confirmWaitingPlan.plan_id);

    const rejectedPlan = createExecutionPlan({
      tenantId: DEFAULT_TENANT,
      payload: {
        project_id: project.id,
        source_type: "manual_request",
        plan_type: "docs_update",
        target_kind: "doc",
        target_refs: [{ system: "docs", target_type: "file", path: "docs/rejected.md", writable: true }],
        requested_by: "requester-b",
        summary: "Rejected plan",
        expected_changes: [{ change_type: "update", summary: "rejected docs" }],
        evidence_refs: { other_refs: [{ system: "hub", ref_kind: "ticket", ref_id: "ops-2" }] },
        impact_scope: { scope: "document", details: [{ kind: "document", ref: "docs/rejected.md", summary: "doc" }] },
        risk_level: "medium",
        confirm_required: true,
        confirm_state: "rejected",
        rollback_plan: { rollback_type: "manual_restore", rollback_steps: [{ step: "restore doc" }] },
        status: "rejected",
        rejection_reason: "rollback owner missing",
      },
      dbConn: db,
    });
    createdPlanIds.push(rejectedPlan.plan_id);

    const runningJob = createExecutionJob({
      tenantId: DEFAULT_TENANT,
      payload: {
        project_id: project.id,
        created_by: "operator-a",
        status: "running",
        job_type: "github_patch_job",
        target_scope: {
          target_kind: "github",
          impact_scope: confirmWaitingPlan.impact_scope,
          target_refs: confirmWaitingPlan.target_refs,
        },
        inputs: {
          summary: "Running job",
          expected_changes: confirmWaitingPlan.expected_changes,
          rollback_plan: confirmWaitingPlan.rollback_plan,
          evidence_refs: confirmWaitingPlan.evidence_refs,
        },
        safety_level: "elevated",
        confirm_state: "approved",
        plan_ref: {
          plan_id: confirmWaitingPlan.plan_id,
          current_plan_version: confirmWaitingPlan.plan_version,
          confirm_state: "approved",
          source_type: confirmWaitingPlan.source_type,
          source_ref: confirmWaitingPlan.source_ref,
        },
        run_ref: {
          run_id: "run_ops_running",
          thread_id: "thread_ops_running",
          project_id: project.id,
        },
      },
      dbConn: db,
    });
    createdJobIds.push(runningJob.execution_job_id);

    const failedJob = createExecutionJob({
      tenantId: DEFAULT_TENANT,
      payload: {
        project_id: project.id,
        created_by: "operator-b",
        status: "failed",
        job_type: "docs_update_job",
        target_scope: {
          target_kind: "doc",
          impact_scope: rejectedPlan.impact_scope,
          target_refs: rejectedPlan.target_refs,
        },
        inputs: {
          summary: "Failed job",
          expected_changes: rejectedPlan.expected_changes,
          rollback_plan: rejectedPlan.rollback_plan,
          evidence_refs: rejectedPlan.evidence_refs,
        },
        safety_level: "guarded",
        confirm_state: "approved",
        plan_ref: {
          plan_id: rejectedPlan.plan_id,
          current_plan_version: rejectedPlan.plan_version,
          confirm_state: "approved",
          source_type: rejectedPlan.source_type,
          source_ref: rejectedPlan.source_ref,
        },
        run_ref: {
          run_id: "run_ops_failed",
          thread_id: "thread_ops_failed",
          project_id: project.id,
        },
      },
      dbConn: db,
    });
    createdJobIds.push(failedJob.execution_job_id);

    const overviewRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/admin/execution-overview?project_id=${encodeURIComponent(project.id)}&limit=10`,
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(overviewRes.statusCode === 200, "execution overview should return 200");
    const overview = JSON.parse(overviewRes.body.toString("utf8"));

    assert(overview.summary.confirm_waiting_plans === 1, "execution overview should count confirm waiting plans");
    assert(overview.summary.rejected_plans === 1, "execution overview should count rejected plans");
    assert(overview.summary.running_jobs === 1, "execution overview should count running jobs");
    assert(overview.summary.failed_jobs === 1, "execution overview should count failed jobs");
    assert(Array.isArray(overview.plans.confirm_waiting) && overview.plans.confirm_waiting.some((plan) => plan.plan_id === confirmWaitingPlan.plan_id), "confirm waiting plans should include pending plan");
    assert(Array.isArray(overview.plans.rejected) && overview.plans.rejected.some((plan) => plan.plan_id === rejectedPlan.plan_id), "rejected plans should include rejected plan");
    assert(Array.isArray(overview.jobs.failed) && overview.jobs.failed.some((job) => job.execution_job_id === failedJob.execution_job_id), "failed jobs should include failed job");
    assert(Array.isArray(overview.jobs.running) && overview.jobs.running.some((job) => job.execution_job_id === runningJob.execution_job_id), "running jobs should include running job");
    assert(Array.isArray(overview.breakdowns.plan_confirm_state) && overview.breakdowns.plan_confirm_state.some((row) => row.confirm_state === "pending"), "plan confirm state breakdown should include pending");
    assert(Array.isArray(overview.breakdowns.job_status) && overview.breakdowns.job_status.some((row) => row.status === "failed"), "job status breakdown should include failed");
  } finally {
    createdJobIds.forEach((id) => {
      db.prepare("DELETE FROM execution_jobs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdPlanIds.forEach((id) => {
      db.prepare("DELETE FROM execution_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
