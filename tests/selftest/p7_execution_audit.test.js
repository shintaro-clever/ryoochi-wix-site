"use strict";

const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

function auditActionsByEntity(entityId) {
  return db.prepare(
    "SELECT action, meta_json FROM audit_logs WHERE tenant_id=? ORDER BY created_at ASC"
  ).all(DEFAULT_TENANT).filter((row) => {
    try {
      const meta = row.meta_json ? JSON.parse(row.meta_json) : {};
      return meta.plan_id === entityId || meta.execution_job_id === entityId;
    } catch {
      return false;
    }
  });
}

async function createPlan(handler, payload) {
  const res = await requestLocal(handler, {
    method: "POST",
    url: "/api/execution-plans",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { res, body: JSON.parse(res.body.toString("utf8")) };
}

async function run() {
  process.env.AUTH_MODE = "off";
  const server = createApiServer(db);
  const handler = server.listeners("request")[0];
  const createdPlanIds = [];
  const createdJobIds = [];
  const projectBase = `audit-${Date.now()}`;

  try {
    const rejectedPlanRes = await createPlan(handler, {
      project_id: `${projectBase}-reject`,
      source_type: "phase5_ai_proposal",
      plan_type: "docs_update",
      target_kind: "github",
      summary: "Rejected plan",
      target_refs: [{ system: "github", target_type: "file", path: "docs/reject.md", writable: true }],
      expected_changes: [{ change_type: "update", summary: "reject me" }],
      impact_scope: { scope: "project", details: [{ kind: "file", ref: "docs/reject.md", summary: "doc" }] },
      rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert" }] },
      evidence_refs: { other_refs: [{ system: "repo", ref_kind: "doc", path: "docs/reject.md", label: "doc" }] },
      risk_level: "high",
    });
    assert(rejectedPlanRes.res.statusCode === 201, "rejected plan should be created");
    const rejectedPlan = rejectedPlanRes.body;
    createdPlanIds.push(rejectedPlan.plan_id);
    const rejectSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(rejectedPlan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const rejectSessionBody = JSON.parse(rejectSession.body.toString("utf8"));
    const rejectRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(rejectedPlan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject", confirm_token: rejectSessionBody.confirm_token, reason: "insufficient rollback detail" }),
    });
    assert(rejectRes.statusCode === 200, "reject should succeed");

    const approvedPlanRes = await createPlan(handler, {
      project_id: `${projectBase}-approve`,
      source_type: "phase5_ai_proposal",
      plan_type: "docs_update",
      target_kind: "github",
      summary: "Approved plan",
      target_refs: [{ system: "github", target_type: "file", path: "docs/approve.md", writable: true }],
      expected_changes: [{ change_type: "update", summary: "approve me" }],
      impact_scope: { scope: "project", details: [{ kind: "file", ref: "docs/approve.md", summary: "doc" }] },
      rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert" }] },
      evidence_refs: { other_refs: [{ system: "repo", ref_kind: "doc", path: "docs/approve.md", label: "doc" }] },
      risk_level: "high",
    });
    assert(approvedPlanRes.res.statusCode === 201, "approved plan should be created");
    const approvedPlan = approvedPlanRes.body;
    createdPlanIds.push(approvedPlan.plan_id);
    const approveSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(approvedPlan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const approveSessionBody = JSON.parse(approveSession.body.toString("utf8"));
    const approveRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(approvedPlan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: approveSessionBody.confirm_token }),
    });
    assert(approveRes.statusCode === 200, "approve should succeed");

    const createJobRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: approvedPlan.plan_id }),
    });
    assert(createJobRes.statusCode === 201, "job create should succeed");
    const job = JSON.parse(createJobRes.body.toString("utf8"));
    createdJobIds.push(job.execution_job_id);

    const startJobRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/execution-jobs/${encodeURIComponent(job.execution_job_id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });
    assert(startJobRes.statusCode === 200, "job start should succeed");

    const finishJobRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/execution-jobs/${encodeURIComponent(job.execution_job_id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "succeeded" }),
    });
    assert(finishJobRes.statusCode === 200, "job finish should succeed");

    const rejectedDrafts = db.prepare(
      "SELECT event_type,draft_state,commit_condition,meta_json FROM audit_event_drafts WHERE tenant_id=? AND entity_type='execution_plan' AND entity_id=? ORDER BY created_at ASC"
    ).all(DEFAULT_TENANT, rejectedPlan.plan_id);
    assert(rejectedDrafts.some((row) => row.event_type === "plan.created" && row.draft_state === "committed"), "plan.created draft should be committed");
    assert(rejectedDrafts.some((row) => row.event_type === "plan.rejected" && row.draft_state === "committed"), "plan.rejected draft should be committed");
    const rejectedMeta = JSON.parse(rejectedDrafts.find((row) => row.event_type === "plan.rejected").meta_json || "{}");
    assert(rejectedMeta.reason === "insufficient rollback detail", "plan.rejected draft should keep rejection reason");

    const jobDrafts = db.prepare(
      "SELECT event_type,draft_state,commit_condition,committed_at FROM audit_event_drafts WHERE tenant_id=? AND entity_type='execution_job' AND entity_id=? ORDER BY created_at ASC"
    ).all(DEFAULT_TENANT, job.execution_job_id);
    assert(jobDrafts.some((row) => row.event_type === "job.created"), "job.created draft should exist");
    assert(jobDrafts.some((row) => row.event_type === "job.started" && row.draft_state === "committed"), "job.started draft should be committed");
    assert(jobDrafts.some((row) => row.event_type === "job.finished" && row.draft_state === "committed"), "job.finished draft should be committed");
    const createdDraft = jobDrafts.find((row) => row.event_type === "job.created");
    assert(createdDraft.commit_condition.includes("succeeded"), "job.created draft should explain commit condition");
    assert(createdDraft.draft_state === "committed", "job.created draft should become committed after finish");

    const approvedActions = auditActionsByEntity(approvedPlan.plan_id).map((row) => row.action);
    assert(approvedActions.includes("execution_plan.created"), "audit log should keep plan.created");
    assert(approvedActions.includes("execution_plan.approved"), "audit log should keep plan.approved");
    const jobActions = auditActionsByEntity(job.execution_job_id).map((row) => row.action);
    assert(jobActions.includes("execution_job.created"), "audit log should keep job.created");
    assert(jobActions.includes("execution_job.started"), "audit log should keep job.started");
    assert(jobActions.includes("execution_job.finished"), "audit log should keep job.finished");
  } finally {
    if (createdJobIds.length) {
      db.prepare(`DELETE FROM execution_jobs WHERE tenant_id=? AND id IN (${createdJobIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdJobIds);
      db.prepare(`DELETE FROM audit_event_drafts WHERE tenant_id=? AND entity_type='execution_job' AND entity_id IN (${createdJobIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdJobIds);
    }
    if (createdPlanIds.length) {
      db.prepare(`DELETE FROM execution_plans WHERE tenant_id=? AND id IN (${createdPlanIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdPlanIds);
      db.prepare(`DELETE FROM audit_event_drafts WHERE tenant_id=? AND entity_type='execution_plan' AND entity_id IN (${createdPlanIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdPlanIds);
    }
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND action IN (?,?,?,?,?,?,?)").run(
      DEFAULT_TENANT,
      "execution_plan.created",
      "execution_plan.approved",
      "execution_plan.rejected",
      "execution_job.created",
      "execution_job.started",
      "execution_job.finished",
      "execution_job.drafted"
    );
    server.close();
  }
}

module.exports = { run };
