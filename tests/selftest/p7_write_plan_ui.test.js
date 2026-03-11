"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createExecutionPlan } = require("../../src/db/executionPlans");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const writePlansHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/write-plans.html"), "utf8");
  const workspaceHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-workspace.html"), "utf8");
  const opsHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/ops-console.html"), "utf8");
  const confirmHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/execution-plan-confirm.html"), "utf8");

  assert(writePlansHtml.includes("Write Plan Console"), "write-plan UI should render console title");
  assert(writePlansHtml.includes("Write Plan 一覧"), "write-plan UI should render list section");
  assert(writePlansHtml.includes("承認待ち"), "write-plan UI should render pending filter");
  assert(writePlansHtml.includes("却下済み"), "write-plan UI should render rejected filter");
  assert(writePlansHtml.includes("confirm 画面へ"), "write-plan UI should link to confirm screen");
  assert(workspaceHtml.includes("workspace-write-plans-link"), "workspace should link to write-plan console");
  assert(opsHtml.includes("/ui/write-plans.html"), "ops console should link to write-plan console");
  assert(confirmHtml.includes("write_plan_id"), "confirm screen should support write_plan_id fallback");

  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdWritePlanIds = [];
  const createdExecutionPlanIds = [];
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
      body: JSON.stringify({ name: "p7-write-plan-ui", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const pendingRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/write-plans",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        source_type: "manual_request",
        source_ref: { system: "hub", ref_kind: "workspace_request", ref_id: "pending-001", metadata: { entrypoint: "workspace" } },
        target_kind: "github",
        target_files: ["src/pending.js"],
        summary: "Pending write plan",
        expected_changes: [{ change_type: "update", summary: "pending change", target_ref: { system: "github", target_type: "file", path: "src/pending.js", writable: true } }],
        evidence_refs: { other_refs: [{ system: "hub", ref_kind: "ticket", ref_id: "pending-001", label: "ticket" }] },
        confirm_required: true,
      }),
    });
    assert(pendingRes.statusCode === 201, "pending write plan create should return 201");
    const pendingPlan = JSON.parse(pendingRes.body.toString("utf8"));
    createdWritePlanIds.push(pendingPlan.write_plan_id);

    const rejectedRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/write-plans",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        source_type: "phase6_governance_request",
        source_ref: { system: "hub", ref_kind: "admin_request", ref_id: "reject-001", metadata: { entrypoint: "admin" } },
        target_kind: "doc",
        target_files: ["docs/rejected.md"],
        summary: "Rejected write plan",
        expected_changes: [{ change_type: "update", summary: "rejected change", target_ref: { system: "docs", target_type: "file", path: "docs/rejected.md", writable: true } }],
        evidence_refs: { other_refs: [{ system: "hub", ref_kind: "ticket", ref_id: "reject-001", label: "ticket" }] },
        confirm_required: true,
      }),
    });
    assert(rejectedRes.statusCode === 201, "rejected write plan create should return 201");
    const rejectedPlan = JSON.parse(rejectedRes.body.toString("utf8"));
    createdWritePlanIds.push(rejectedPlan.write_plan_id);

    const linkedExecutionPlan = createExecutionPlan({
      payload: {
        project_id: project.id,
        source_type: "manual_request",
        source_ref: {
          system: "hub",
          ref_kind: "write_plan",
          ref_id: rejectedPlan.write_plan_id,
          label: "linked write plan rejection",
          metadata: {},
        },
        plan_type: "docs_update",
        target_kind: "doc",
        target_refs: rejectedPlan.target_refs,
        requested_by: "approver-a",
        summary: "Rejected execution plan",
        expected_changes: rejectedPlan.expected_changes,
        evidence_refs: rejectedPlan.evidence_refs,
        impact_scope: { scope: "document", details: [{ kind: "document", ref: "docs/rejected.md", summary: "single doc" }] },
        risk_level: "medium",
        confirm_required: true,
        confirm_state: "rejected",
        rollback_plan: { rollback_type: "manual_restore", rollback_steps: [{ step: "restore docs/rejected.md" }] },
        status: "rejected",
        rejection_reason: "missing evidence",
      },
      dbConn: db,
    });
    createdExecutionPlanIds.push(linkedExecutionPlan.plan_id);

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/write-plans?project_id=${encodeURIComponent(project.id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRes.statusCode === 200, "write-plan list should return 200");
    const listPayload = JSON.parse(listRes.body.toString("utf8"));
    assert(Array.isArray(listPayload.items) && listPayload.items.length === 2, "write-plan list should include created items");
    assert(listPayload.counts.approval_pending === 1, "write-plan list should count pending items");
    assert(listPayload.counts.rejected === 1, "write-plan list should count rejected items");
    assert(listPayload.items.some((item) => item.approval_state === "approval_pending"), "write-plan list should expose pending bucket");
    assert(listPayload.items.some((item) => item.approval_state === "rejected"), "write-plan list should expose rejected bucket");

    const rejectedOnlyRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/write-plans?project_id=${encodeURIComponent(project.id)}&approval_state=rejected`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(rejectedOnlyRes.statusCode === 200, "write-plan rejected list should return 200");
    const rejectedOnly = JSON.parse(rejectedOnlyRes.body.toString("utf8"));
    assert(rejectedOnly.items.length === 1, "write-plan rejected filter should narrow results");
    assert(rejectedOnly.items[0].related_execution_plan && rejectedOnly.items[0].related_execution_plan.plan_id === linkedExecutionPlan.plan_id, "write-plan detail should include related execution plan");

    const detailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/write-plans/${encodeURIComponent(rejectedPlan.write_plan_id)}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detailRes.statusCode === 200, "write-plan detail should return 200");
    const detail = JSON.parse(detailRes.body.toString("utf8"));
    assert(detail.approval_state === "rejected", "write-plan detail should expose rejected state");
    assert(detail.related_execution_plan && detail.related_execution_plan.rejection_reason === "missing evidence", "write-plan detail should expose rejection reason");
  } finally {
    createdExecutionPlanIds.forEach((id) => {
      db.prepare("DELETE FROM execution_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdWritePlanIds.forEach((id) => {
      db.prepare("DELETE FROM write_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
