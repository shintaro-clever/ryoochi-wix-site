"use strict";

const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

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

  try {
    const basePayload = {
      project_id: `project-confirm-${Date.now()}`,
      source_type: "phase5_ai_proposal",
      plan_type: "docs_update",
      target_kind: "github",
      summary: "Update rollout runbook before execution",
      target_refs: [{ system: "github", target_type: "file", path: "docs/runbook.md", writable: true }],
      expected_changes: [{ change_type: "update", summary: "Refresh rollout steps" }],
      impact_scope: { scope: "project", details: [{ kind: "repo", ref: "owner/repo", summary: "runbook changes" }] },
      rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "Revert runbook commit" }] },
      evidence_refs: { other_refs: [{ system: "github", ref_kind: "doc", path: "docs/runbook.md", label: "runbook" }] },
      risk_level: "high",
    };

    const tampered = await createPlan(handler, { ...basePayload, project_id: `${basePayload.project_id}-tamper`, confirm_required: false });
    assert(tampered.res.statusCode === 400, "tampered confirm_required=false should be rejected");

    const created = await createPlan(handler, basePayload);
    assert(created.res.statusCode === 201, "execution plan create should succeed");
    const plan = created.body;
    createdPlanIds.push(plan.plan_id);

    const unapprovedJob = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan.plan_id }),
    });
    assert(unapprovedJob.statusCode === 409, "unapproved plan should not create execution job");

    const sessionRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(sessionRes.statusCode === 201, "confirm session should be issued");
    const sessionBody = JSON.parse(sessionRes.body.toString("utf8"));
    const confirmToken = sessionBody.confirm_token;
    assert(typeof confirmToken === "string" && confirmToken.length > 20, "confirm token should be returned");

    db.prepare("UPDATE execution_plans SET confirm_session_json=? WHERE tenant_id=? AND id=?").run(
      JSON.stringify({
        ...sessionBody.confirm_session,
        plan_id: plan.plan_id,
        tenant_id: DEFAULT_TENANT,
        project_id: plan.project_id,
        confirm_hash: db.prepare("SELECT confirm_session_json FROM execution_plans WHERE tenant_id=? AND id=?").get(DEFAULT_TENANT, plan.plan_id).confirm_session_json
          ? JSON.parse(db.prepare("SELECT confirm_session_json FROM execution_plans WHERE tenant_id=? AND id=?").get(DEFAULT_TENANT, plan.plan_id).confirm_session_json).confirm_hash
          : "",
        expires_at: "2000-01-01T00:00:00.000Z",
      }),
      DEFAULT_TENANT,
      plan.plan_id
    );
    const expiredRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: confirmToken }),
    });
    const expiredBody = JSON.parse(expiredRes.body.toString("utf8"));
    assert(expiredRes.statusCode === 409, "expired confirm token should be rejected");
    assert(expiredBody.details.failure_code === "confirm_token_expired", "expired token should return explicit failure code");

    const sessionRes2 = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const sessionBody2 = JSON.parse(sessionRes2.body.toString("utf8"));
    db.prepare("UPDATE execution_plans SET plan_version=? WHERE tenant_id=? AND id=?").run(2, DEFAULT_TENANT, plan.plan_id);
    const versionMismatch = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: sessionBody2.confirm_token }),
    });
    const versionMismatchBody = JSON.parse(versionMismatch.body.toString("utf8"));
    assert(versionMismatch.statusCode === 409, "plan version mismatch should be rejected");
    assert(versionMismatchBody.details.failure_code === "plan_version_mismatch", "version mismatch should be explicit");

    const updated = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Revised rollout runbook with explicit rollback", risk_level: "high", impact_scope: basePayload.impact_scope }),
    });
    assert(updated.statusCode === 200, "plan should be patchable");

    const rejectSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const rejectSessionBody = JSON.parse(rejectSession.body.toString("utf8"));
    const rejectRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject", confirm_token: rejectSessionBody.confirm_token, reason: "rollback plan lacked operator owner" }),
    });
    const rejectedPlan = JSON.parse(rejectRes.body.toString("utf8"));
    assert(rejectRes.statusCode === 200, "reject should succeed");
    assert(rejectedPlan.rejection_reason === "rollback plan lacked operator owner", "reject reason should be stored");

    const reproposed = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: "Revised rollout runbook with operator owner and rollback owner",
        risk_level: "high",
        impact_scope: basePayload.impact_scope,
        rollback_plan: {
          rollback_type: "git_revert",
          rollback_steps: [{ step: "Revert runbook commit" }, { step: "Notify operator owner" }],
        },
      }),
    });
    const reproposedBody = JSON.parse(reproposed.body.toString("utf8"));
    assert(reproposed.statusCode === 200, "reproposal should succeed");
    assert(reproposedBody.reproposal_diff && Array.isArray(reproposedBody.reproposal_diff.changed_fields), "reproposal diff should be exposed");

    const approveSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const approveSessionBody = JSON.parse(approveSession.body.toString("utf8"));
    const approveRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: approveSessionBody.confirm_token }),
    });
    const approvedPlan = JSON.parse(approveRes.body.toString("utf8"));
    assert(approveRes.statusCode === 200, "approve should succeed");
    assert(approvedPlan.confirm_state === "approved", "plan should become approved");

    const jobRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan.plan_id }),
    });
    const jobBody = JSON.parse(jobRes.body.toString("utf8"));
    assert(jobRes.statusCode === 201, "approved plan should create execution job");
    assert(jobBody.audit_draft && jobBody.audit_draft.rollback_plan, "execution job should retain audit draft");
    assert(typeof jobBody.job_type === "string" && jobBody.job_type.length > 0, "execution job should expose job_type");
    assert(jobBody.target_scope && Array.isArray(jobBody.target_scope.target_refs), "execution job should expose target_scope");
    assert(jobBody.inputs && Array.isArray(jobBody.inputs.expected_changes), "execution job should expose inputs");
    assert(typeof jobBody.safety_level === "string" && jobBody.safety_level.length > 0, "execution job should expose safety_level");
    assert(jobBody.confirm_state === "approved", "execution job should keep confirm_state");
    assert(jobBody.plan_ref && jobBody.plan_ref.plan_id === plan.plan_id, "execution job should expose plan_ref");
    assert(jobBody.run_ref && jobBody.run_ref.project_id === plan.project_id, "execution job should expose run_ref");
    createdJobIds.push(jobBody.execution_job_id);

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/execution-jobs?project_id=${encodeURIComponent(plan.project_id)}`,
      headers: { "content-type": "application/json" },
    });
    const listBody = JSON.parse(listRes.body.toString("utf8"));
    assert(listRes.statusCode === 200, "execution jobs list should succeed");
    assert(Array.isArray(listBody.items) && listBody.items.some((item) => item.execution_job_id === jobBody.execution_job_id), "execution jobs list should include created job");

    const detailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/execution-jobs/${encodeURIComponent(jobBody.execution_job_id)}`,
      headers: { "content-type": "application/json" },
    });
    const detailBody = JSON.parse(detailRes.body.toString("utf8"));
    assert(detailRes.statusCode === 200, "execution job detail should succeed");
    assert(detailBody.execution_job_id === jobBody.execution_job_id, "execution job detail should match");
    assert(detailBody.plan_ref && detailBody.plan_ref.plan_id === plan.plan_id, "execution job detail should include plan_ref");

    const statusRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/execution-jobs/${encodeURIComponent(jobBody.execution_job_id)}/status`,
      headers: { "content-type": "application/json" },
    });
    const statusBody = JSON.parse(statusRes.body.toString("utf8"));
    assert(statusRes.statusCode === 200, "execution job status should succeed");
    assert(statusBody.status === "queued", "execution job status should reflect queued state");
    assert(statusBody.confirm_state === "approved", "execution job status should include confirm_state");

    const selfApprovalPlan = await createPlan(handler, {
      ...basePayload,
      project_id: `${basePayload.project_id}-self`,
      requested_by: "dev-auth-bypass",
      confirm_policy: {
        mode: "explicit_confirm",
        required_approvers: [{ actor_id: "dev-auth-bypass", role: "admin", label: "same actor" }],
      },
    });
    assert(selfApprovalPlan.res.statusCode === 201, "self approval test plan should be created");
    createdPlanIds.push(selfApprovalPlan.body.plan_id);
    const selfSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(selfApprovalPlan.body.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const selfSessionBody = JSON.parse(selfSession.body.toString("utf8"));
    const selfApprove = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(selfApprovalPlan.body.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: selfSessionBody.confirm_token }),
    });
    const selfApproveBody = JSON.parse(selfApprove.body.toString("utf8"));
    assert(selfApprove.statusCode === 403, "self approval should be rejected");
    assert(selfApproveBody.details.failure_code === "self_approval_forbidden", "self approval should return explicit failure code");

    const roleRestrictedPlan = await createPlan(handler, {
      ...basePayload,
      project_id: `${basePayload.project_id}-role`,
      requested_by: "requester-other",
      confirm_policy: {
        mode: "explicit_confirm",
        required_approvers: [{ role: "project_operator", label: "operator" }],
      },
    });
    assert(roleRestrictedPlan.res.statusCode === 201, "role restricted plan should be created");
    createdPlanIds.push(roleRestrictedPlan.body.plan_id);
    const roleSession = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(roleRestrictedPlan.body.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const roleSessionBody = JSON.parse(roleSession.body.toString("utf8"));
    const roleApprove = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(roleRestrictedPlan.body.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: roleSessionBody.confirm_token }),
    });
    const roleApproveBody = JSON.parse(roleApprove.body.toString("utf8"));
    assert(roleApprove.statusCode === 403, "actor without required role should be rejected");
    assert(roleApproveBody.details.failure_code === "approver_not_allowed", "role mismatch should be explicit");
  } finally {
    if (createdJobIds.length > 0) {
      db.prepare(`DELETE FROM execution_jobs WHERE tenant_id=? AND id IN (${createdJobIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdJobIds);
    }
    if (createdPlanIds.length > 0) {
      db.prepare(`DELETE FROM execution_plans WHERE tenant_id=? AND id IN (${createdPlanIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdPlanIds);
    }
    server.close();
  }
}

module.exports = { run };
