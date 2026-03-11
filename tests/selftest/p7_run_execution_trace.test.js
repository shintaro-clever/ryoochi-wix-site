"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createExecutionPlan } = require("../../src/db/executionPlans");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdRunIds = [];
  const createdWritePlanIds = [];
  const createdExecutionPlanIds = [];
  const createdExecutionJobIds = [];
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "p7-run-trace", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/p7_run_execution_trace.json",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunRes.statusCode === 201, "run create should return 201");
    const createdRun = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, createdRun.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const writePlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/write-plans",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        run_id: createdRun.run_id,
        source_type: "manual_request",
        source_ref: { system: "hub", ref_kind: "workspace_request", ref_id: "run-trace-wp" },
        target_kind: "github",
        target_files: ["src/trace.js"],
        summary: "Traceable write plan",
        expected_changes: [{ change_type: "update", summary: "update trace file", target_ref: { system: "github", target_type: "file", path: "src/trace.js", writable: true } }],
        evidence_refs: { other_refs: [{ system: "hub", ref_kind: "ticket", ref_id: "trace-1", label: "trace" }] },
        confirm_required: true,
      }),
    });
    assert(writePlanRes.statusCode === 201, "write plan create should return 201");
    const writePlan = JSON.parse(writePlanRes.body.toString("utf8"));
    createdWritePlanIds.push(writePlan.write_plan_id);

    const executionPlan = createExecutionPlan({
      payload: {
        project_id: project.id,
        run_id: createdRun.run_id,
        source_type: "manual_request",
        source_ref: { system: "hub", ref_kind: "write_plan", ref_id: writePlan.write_plan_id, label: "run trace write plan" },
        plan_type: "docs_update",
        target_kind: "github",
        target_refs: writePlan.target_refs,
        requested_by: "trace-user",
        summary: "Traceable execution plan",
        expected_changes: writePlan.expected_changes,
        evidence_refs: writePlan.evidence_refs,
        impact_scope: { scope: "project", details: [{ kind: "file", ref: "src/trace.js", summary: "single file" }] },
        risk_level: "high",
        confirm_required: true,
        plan_version: 1,
        confirm_state: "approved",
        rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert trace commit" }] },
        status: "approved",
        approved_by: "trace-approver",
        approved_at: new Date().toISOString(),
      },
      dbConn: db,
    });
    createdExecutionPlanIds.push(executionPlan.plan_id);

    const createJobRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/execution-jobs",
      headers: authz,
      body: JSON.stringify({ plan_id: executionPlan.plan_id }),
    });
    assert(createJobRes.statusCode === 201, "execution job create should return 201");
    const createdJob = JSON.parse(createJobRes.body.toString("utf8"));
    createdExecutionJobIds.push(createdJob.execution_job_id);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(Array.isArray(runDetail.related_write_plans) && runDetail.related_write_plans.some((item) => item.write_plan_id === writePlan.write_plan_id), "run detail should expose related write plans");
    assert(Array.isArray(runDetail.related_execution_plans) && runDetail.related_execution_plans.some((item) => item.plan_id === executionPlan.plan_id), "run detail should expose related execution plans");
    assert(Array.isArray(runDetail.related_execution_jobs) && runDetail.related_execution_jobs.some((item) => item.execution_job_id === createdJob.execution_job_id), "run detail should expose related execution jobs");
  } finally {
    createdExecutionJobIds.forEach((id) => {
      db.prepare("DELETE FROM execution_jobs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdExecutionPlanIds.forEach((id) => {
      db.prepare("DELETE FROM execution_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdWritePlanIds.forEach((id) => {
      db.prepare("DELETE FROM write_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
