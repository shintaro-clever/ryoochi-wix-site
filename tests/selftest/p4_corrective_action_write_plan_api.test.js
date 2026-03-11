const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { parseRunIdInput } = require("../../src/api/runs");
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
      body: JSON.stringify({ name: "p4-corrective-connect", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const putSettingsRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        github_default_branch: "main",
        github_default_path: "src",
        github_secret_id: "vault://github/tokens/p4-act-02",
        github_operation_mode: "controlled_write",
        github_allowed_branches: "main,feature/*",
        figma_file_key: "CutkQD2XudkCe8eJ1jDfkZ",
        figma_secret_id: "vault://figma/tokens/p4-act-02",
        figma_page_scope: "page:Landing",
        figma_frame_scope: "frame_id:11:22",
        figma_writable_scope: "frame",
        figma_operation_mode: "controlled_write",
        figma_allowed_frame_scope: "frame_id:11:22",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "settings put should return 200");

    const runCreateRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/p4_corrective_connect.json",
        inputs: {
          page_url: "https://example.com",
          structure_diff: {
            diffs: {
              reasons: [
                { axis: "structure", reason_code: "instance_variant_changed", node_id: "cta" },
                { axis: "structure", reason_code: "slot_changed", node_id: "hero" },
              ],
            },
          },
          behavior_diff: {
            reasons: [
              { axis: "behavior", reason_code: "missing_state_candidate", state: "loading" },
            ],
          },
          execution_diff: {
            reasons: [
              { axis: "execution", reason_code: "environment_only_mismatch" },
            ],
          },
        },
      }),
    });
    assert(runCreateRes.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreateRes.body.toString("utf8"));
    const parsedRun = parseRunIdInput(runPayload.run_id);
    assert(parsedRun.ok, "run id should be valid");
    createdRunIds.push(parsedRun.internalId);

    const githubPlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        category: "state_addition",
        provider: "github",
        write: {
          owner: "octocat",
          repo: "hello-world",
          title: "corrective-state-addition",
          file_path: "src/state-machine.js",
          file_content: "module.exports = { loading: true };\n",
          head_branch: "feature/p4-act-02",
        },
      }),
    });
    assert(githubPlanRes.statusCode === 201, "github corrective action write plan should return 201");
    const githubPlan = JSON.parse(githubPlanRes.body.toString("utf8"));
    assert(githubPlan.confirm_required === true, "github corrective action plan should require confirm");
    assert(githubPlan.write_plan && githubPlan.write_plan.confirm_token, "github write plan should include confirm_token");
    assert(githubPlan.write_plan_record && typeof githubPlan.write_plan_record.write_plan_id === "string", "github write plan should persist generic write plan record");
    assert(Array.isArray(githubPlan.write_plan_record.target_files) && githubPlan.write_plan_record.target_files.includes("src/state-machine.js"), "github write plan record should preserve target files");
    assert(githubPlan.write_plan_record.target_refs.some((item) => item.target_type === "repo"), "github write plan record should include repo target");
    assert(githubPlan.write_plan_record.target_refs.some((item) => item.target_type === "branch"), "github write plan record should include branch target");
    assert(githubPlan.write_plan_record.target_refs.some((item) => item.target_type === "file"), "github write plan record should include file target");
    assert(Array.isArray(githubPlan.write_plan_record.expected_changes) && githubPlan.write_plan_record.expected_changes.length > 0, "github write plan record should preserve expected changes");
    assert(githubPlan.write_plan_record.confirm_required === true, "github write plan record should keep confirm_required");
    assert(
      githubPlan.write_plan.planned_action && githubPlan.write_plan.planned_action.status === "confirm_required",
      "github planned action should stay confirm_required"
    );

    const figmaPlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        category: "component_swap",
        provider: "figma",
        write: {
          change_type: "update",
          page_id: "11",
          page_name: "Landing",
          frame_id: "11:22",
          frame_name: "Hero",
          node_id: "11:22:node1",
          component_id: "cmp_hero_button",
          component_name: "Hero Button",
          component_key: "figma-component-key-hero",
          component_set_id: "set_hero_button",
          component_set_name: "Hero Button Set",
        },
      }),
    });
    assert(figmaPlanRes.statusCode === 201, "figma corrective action write plan should return 201");
    const figmaPlan = JSON.parse(figmaPlanRes.body.toString("utf8"));
    assert(figmaPlan.confirm_required === true, "figma corrective action plan should require confirm");
    assert(figmaPlan.write_plan && figmaPlan.write_plan.confirm_token, "figma write plan should include confirm_token");
    assert(figmaPlan.write_plan_record && typeof figmaPlan.write_plan_record.write_plan_id === "string", "figma write plan should persist generic write plan record");
    assert(Array.isArray(figmaPlan.write_plan_record.target_refs) && figmaPlan.write_plan_record.target_refs.length > 0, "figma write plan record should preserve targets");
    assert(figmaPlan.write_plan_record.target_refs.some((item) => item.target_type === "page"), "figma write plan record should include page target");
    assert(figmaPlan.write_plan_record.target_refs.some((item) => item.target_type === "frame"), "figma write plan record should include frame target");
    assert(figmaPlan.write_plan_record.target_refs.some((item) => item.target_type === "component"), "figma write plan record should include component target");
    assert(figmaPlan.write_plan_record.target_refs.some((item) => item.target_type === "node"), "figma write plan record should include node target");
    assert(figmaPlan.write_plan_record.source_ref && figmaPlan.write_plan_record.source_ref.ref_kind === "corrective_action", "figma write plan record should preserve source_ref");
    assert(
      figmaPlan.write_plan.planned_action && figmaPlan.write_plan.planned_action.status === "confirm_required",
      "figma planned action should stay confirm_required"
    );

    const forbiddenAutoExecuteRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        category: "state_addition",
        provider: "github",
        auto_execute: true,
        write: {
          owner: "octocat",
          repo: "hello-world",
          file_path: "src/state-machine.js",
          file_content: "module.exports = {};\n",
          head_branch: "feature/p4-act-02-blocked",
        },
      }),
    });
    assert(forbiddenAutoExecuteRes.statusCode === 400, "auto execution should be rejected");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    const ops = Array.isArray(runDetail.external_operations) ? runDetail.external_operations : [];
    assert(
      ops.some((entry) => entry && entry.provider === "fidelity" && entry.operation_type === "fidelity.corrective_action_write_plan"),
      "corrective action connection should be audited"
    );
    assert(
      ops.some((entry) => entry && entry.provider === "github" && entry.operation_type === "github.write_plan"),
      "github write plan should be recorded"
    );
    assert(
      ops.some((entry) => entry && entry.provider === "figma" && entry.operation_type === "figma.write_plan"),
      "figma write plan should be recorded"
    );
    assert(
      !ops.some(
        (entry) =>
          entry &&
          ((entry.provider === "github" && entry.operation_type === "github.create_pr") ||
            (entry.provider === "figma" && entry.operation_type === "figma.apply_changes")) &&
          entry.result &&
          entry.result.status === "ok"
      ),
      "bridge must not auto execute controlled writes"
    );
  } finally {
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
