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
    const created = await createPlan(handler, {
      project_id: `github-plan-${Date.now()}`,
      source_type: "phase4_corrective_action",
      plan_type: "docs_update",
      target_kind: "github",
      summary: "Update GitHub runbook",
      target_refs: [
        { system: "github", target_type: "repo", id: "octocat/hello-world", name: "octocat/hello-world", writable: true, metadata: { repository: "octocat/hello-world" } },
        { system: "github", target_type: "branch", id: "feature/runbook", name: "feature/runbook", writable: true, scope: "octocat/hello-world", metadata: { repository: "octocat/hello-world", target_branch: "feature/runbook" } },
        { system: "github", target_type: "file", path: "docs/runbook.md", name: "runbook.md", writable: true, scope: "octocat/hello-world", metadata: { repository: "octocat/hello-world", target_branch: "feature/runbook" } },
      ],
      expected_changes: [
        {
          change_type: "update",
          summary: "Refresh rollout steps",
          target_ref: { system: "github", target_type: "file", path: "docs/runbook.md", name: "runbook.md", writable: true },
        },
      ],
      impact_scope: { scope: "repo", details: [{ kind: "file", ref: "docs/runbook.md", summary: "single doc file" }] },
      rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert runbook commit" }] },
      evidence_refs: { other_refs: [{ system: "github", ref_kind: "repo", ref_id: "octocat/hello-world", label: "repo" }] },
      risk_level: "high",
    });
    assert(created.res.statusCode === 201, "github execution plan should be created");
    const plan = created.body;
    createdPlanIds.push(plan.plan_id);
    assert(plan.target_refs.some((item) => item.target_type === "repo"), "execution plan should preserve github repo target");
    assert(plan.target_refs.some((item) => item.target_type === "branch"), "execution plan should preserve github branch target");
    assert(plan.target_refs.some((item) => item.target_type === "file"), "execution plan should preserve github file target");

    const sessionRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(sessionRes.statusCode === 201, "github confirm session should be issued");
    const sessionBody = JSON.parse(sessionRes.body.toString("utf8"));

    const approveRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: sessionBody.confirm_token }),
    });
    assert(approveRes.statusCode === 200, "github execution plan should be approved");

    const jobRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan.plan_id }),
    });
    assert(jobRes.statusCode === 201, "github execution job should be created");
    const job = JSON.parse(jobRes.body.toString("utf8"));
    createdJobIds.push(job.execution_job_id);
    assert(job.target_scope.target_kind === "github", "execution job should preserve github target kind");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "repo"), "execution job should preserve github repo target");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "branch"), "execution job should preserve github branch target");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "file"), "execution job should preserve github file target");
  } finally {
    if (createdJobIds.length) {
      db.prepare(`DELETE FROM execution_jobs WHERE tenant_id=? AND id IN (${createdJobIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdJobIds);
    }
    if (createdPlanIds.length) {
      db.prepare(`DELETE FROM execution_plans WHERE tenant_id=? AND id IN (${createdPlanIds.map(() => "?").join(",")})`).run(DEFAULT_TENANT, ...createdPlanIds);
    }
    server.close();
  }
}

module.exports = { run };
