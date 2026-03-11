const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
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
  const createdProjectPublicIds = [];
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
      body: JSON.stringify({ name: "p7-write-plan-model", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);
    createdProjectPublicIds.push(project.id);

    const workspaceRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/write-plans",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        source_type: "manual_request",
        source_ref: {
          system: "hub",
          ref_kind: "workspace_request",
          ref_id: "ws-001",
          label: "Workspace write plan",
          metadata: { entrypoint: "workspace" },
        },
        target_kind: "github",
        target_files: ["src/workspace/panel.js"],
        summary: "Update workspace guidance",
        expected_changes: [
          {
            change_type: "update",
            target_ref: { system: "github", target_type: "file", path: "src/workspace/panel.js", writable: true },
            summary: "adjust workspace panel content",
          },
        ],
        evidence_refs: {
          source_documents: [
            { system: "repo", ref_kind: "doc", path: "docs/ai/core/execution-plan-model.md", label: "SoT" },
          ],
        },
        confirm_required: true,
      }),
    });
    assert(workspaceRes.statusCode === 201, "workspace write plan should return 201");
    const workspacePlan = JSON.parse(workspaceRes.body.toString("utf8"));
    assert(typeof workspacePlan.write_plan_id === "string" && workspacePlan.write_plan_id.length > 0, "workspace write plan should have id");
    assert(Array.isArray(workspacePlan.target_files) && workspacePlan.target_files.includes("src/workspace/panel.js"), "workspace write plan should keep target file");
    assert(Array.isArray(workspacePlan.expected_changes) && workspacePlan.expected_changes.length === 1, "workspace write plan should keep expected changes");
    assert(workspacePlan.confirm_required === true, "workspace write plan should keep confirm_required");
    assert(workspacePlan.source_ref && workspacePlan.source_ref.metadata.entrypoint === "workspace", "workspace source_ref should survive");

    const adminRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/write-plans",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        source_type: "phase6_governance_request",
        source_ref: {
          system: "hub",
          ref_kind: "admin_request",
          ref_id: "adm-001",
          label: "Admin write plan",
          metadata: { entrypoint: "admin" },
        },
        target_kind: "doc",
        target_refs: [
          { system: "docs", target_type: "file", path: "docs/runbooks/admin-policy.md", writable: true },
        ],
        summary: "Update admin policy runbook",
        expected_changes: [
          {
            change_type: "update",
            target_ref: { system: "docs", target_type: "file", path: "docs/runbooks/admin-policy.md", writable: true },
            summary: "add policy boundary note",
          },
        ],
        evidence_refs: {
          other_refs: [
            { system: "hub", ref_kind: "ticket", ref_id: "adm-001", label: "admin request" },
          ],
        },
        confirm_required: false,
      }),
    });
    assert(adminRes.statusCode === 201, "admin write plan should return 201");
    const adminPlan = JSON.parse(adminRes.body.toString("utf8"));
    assert(typeof adminPlan.write_plan_id === "string" && adminPlan.write_plan_id.length > 0, "admin write plan should have id");
    assert(Array.isArray(adminPlan.target_refs) && adminPlan.target_refs.length === 1, "admin write plan should keep target refs");
    assert(adminPlan.target_files.includes("docs/runbooks/admin-policy.md"), "admin write plan should derive target_files");
    assert(adminPlan.source_ref && adminPlan.source_ref.metadata.entrypoint === "admin", "admin source_ref should survive");
    assert(adminPlan.confirm_required === false, "admin write plan should keep confirm_required");

    const fetchedRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/write-plans/${workspacePlan.write_plan_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(fetchedRes.statusCode === 200, "write plan get should return 200");
    const fetched = JSON.parse(fetchedRes.body.toString("utf8"));
    assert(fetched.write_plan_id === workspacePlan.write_plan_id, "fetched write plan id should match");
    assert(fetched.approval_state === "approval_pending", "fetched write plan should expose approval state");
    assert(
      JSON.stringify(Object.keys(workspacePlan).sort()) === JSON.stringify(Object.keys(adminPlan).sort()),
      "write plan create shape should stay aligned across entrypoints"
    );
  } finally {
    createdProjectPublicIds.forEach((id) => {
      db.prepare("DELETE FROM write_plans WHERE tenant_id=? AND project_id=?").run(DEFAULT_TENANT, id);
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
