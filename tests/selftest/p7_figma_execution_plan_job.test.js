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
      project_id: `figma-plan-${Date.now()}`,
      source_type: "phase4_corrective_action",
      plan_type: "mixed_change",
      target_kind: "figma",
      summary: "Update Figma hero component",
      target_refs: [
        { system: "figma", target_type: "page", id: "11", name: "Landing", writable: true, metadata: { file_key: "CutkQD2XudkCe8eJ1jDfkZ" } },
        { system: "figma", target_type: "frame", id: "11:22", name: "Hero", writable: true, metadata: { file_key: "CutkQD2XudkCe8eJ1jDfkZ", page_id: "11" } },
        { system: "figma", target_type: "component", id: "cmp_hero_button", name: "Hero Button", writable: true, metadata: { component_key: "figma-component-key-hero" } },
        { system: "figma", target_type: "node", id: "11:22:node1", name: "Hero Button Node", writable: true, metadata: { frame_id: "11:22" } },
      ],
      expected_changes: [
        {
          change_type: "update",
          summary: "Update hero button variant",
          target_ref: { system: "figma", target_type: "component", id: "cmp_hero_button", name: "Hero Button", writable: true },
        },
      ],
      impact_scope: { scope: "frame", details: [{ kind: "component", ref: "cmp_hero_button", summary: "single hero component" }] },
      rollback_plan: { rollback_type: "manual_restore", rollback_steps: [{ step: "restore previous component variant" }] },
      evidence_refs: { other_refs: [{ system: "figma", ref_kind: "frame", ref_id: "11:22", label: "Hero frame" }] },
      risk_level: "high",
    });
    assert(created.res.statusCode === 201, "figma execution plan should be created");
    const plan = created.body;
    createdPlanIds.push(plan.plan_id);
    assert(plan.target_refs.some((item) => item.target_type === "page"), "execution plan should preserve figma page target");
    assert(plan.target_refs.some((item) => item.target_type === "frame"), "execution plan should preserve figma frame target");
    assert(plan.target_refs.some((item) => item.target_type === "component"), "execution plan should preserve figma component target");

    const sessionRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm-session`,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(sessionRes.statusCode === 201, "figma confirm session should be issued");
    const sessionBody = JSON.parse(sessionRes.body.toString("utf8"));

    const approveRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/execution-plans/${encodeURIComponent(plan.plan_id)}/confirm`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", confirm_token: sessionBody.confirm_token }),
    });
    assert(approveRes.statusCode === 200, "figma execution plan should be approved");

    const jobRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan.plan_id }),
    });
    assert(jobRes.statusCode === 201, "figma execution job should be created");
    const job = JSON.parse(jobRes.body.toString("utf8"));
    createdJobIds.push(job.execution_job_id);
    assert(job.target_scope.target_kind === "figma", "execution job should preserve figma target kind");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "page"), "execution job should preserve figma page target");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "frame"), "execution job should preserve figma frame target");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "component"), "execution job should preserve figma component target");
    assert(job.target_scope.target_refs.some((item) => item.target_type === "node"), "execution job should preserve figma node target");
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
