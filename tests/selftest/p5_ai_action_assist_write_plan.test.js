const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-act-ui";

  const createdProjectIds = [];
  const createdRunIds = [];
  const userId = `u-${crypto.randomUUID()}`;
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "p5-act-ui", staging_url: "https://example.com" }),
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
        github_secret_id: "vault://github/tokens/p5-act-ui",
        github_operation_mode: "controlled_write",
        github_allowed_branches: "main,feature/*",
        figma_file_key: "CutkQD2XudkCe8eJ1jDfkZ",
        figma_secret_id: "vault://figma/tokens/p5-act-ui",
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
        target_path: ".ai-runs/{{run_id}}/p5_ai_action_assist_write_plan.json",
        inputs: {
          page_url: "https://example.com",
          connection_context: {
            figma: {
              file_key: "CutkQD2XudkCe8eJ1jDfkZ",
              target: {
                page_id: "11",
                frame_id: "11:22",
                node_ids: ["11:22:node1"],
              },
            },
          },
          structure_diff: {
            diffs: {
              reasons: [
                { axis: "structure", reason_code: "instance_variant_changed", node_id: "cta" },
                { axis: "structure", reason_code: "slot_changed", node_id: "hero" },
              ],
            },
          },
          behavior_diff: {
            reasons: [{ axis: "behavior", reason_code: "missing_state_candidate", state: "loading" }],
          },
          execution_diff: {
            reasons: [{ axis: "execution", reason_code: "environment_only_mismatch" }],
          },
        },
      }),
    });
    assert(runCreateRes.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreateRes.body.toString("utf8"));
    const parsedRun = parseRunIdInput(runPayload.run_id);
    assert(parsedRun.ok, "run id should be valid");
    createdRunIds.push(parsedRun.internalId);

    const planRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-plan",
      headers: authz,
      body: JSON.stringify({ run_id: runPayload.run_id }),
    });
    assert(planRes.statusCode === 200, "corrective action plan should return 200");
    const planBody = JSON.parse(planRes.body.toString("utf8"));
    const githubAction = planBody.corrective_action_plan.actions.find((item) => item.category === "state_addition");
    const figmaAction = planBody.corrective_action_plan.actions.find((item) => item.category === "component_swap");
    assert(githubAction, "github corrective action should exist");
    assert(figmaAction, "figma corrective action should exist");

    nock("https://api.openai.com")
      .post("/v1/responses")
      .times(2)
      .reply(200, {
        output_text: JSON.stringify({
          target_file_or_component: ["src/state-machine.js", "approved component variant binding"],
          expected_impact: ["drift should reduce", "revalidation can focus on targeted scope"],
          confidence: "medium",
          confirm_required: true,
          linked_reason_types: ["missing_state", "component_variant_mismatch"],
        }),
        usage: { input_tokens: 12, output_tokens: 12, total_tokens: 24 },
      });

    const githubAssistRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-action-assist/corrective-action",
      headers: authz,
      body: JSON.stringify({ run_id: runPayload.run_id, action_key: githubAction.key }),
    });
    assert(githubAssistRes.statusCode === 200, "github assist should return 200");
    const githubAssist = JSON.parse(githubAssistRes.body.toString("utf8"));

    const figmaAssistRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-action-assist/corrective-action",
      headers: authz,
      body: JSON.stringify({ run_id: runPayload.run_id, action_key: figmaAction.key }),
    });
    assert(figmaAssistRes.statusCode === 200, "figma assist should return 200");
    const figmaAssist = JSON.parse(figmaAssistRes.body.toString("utf8"));

    const githubWritePlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-action-assist/corrective-action/write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        action_key: githubAction.key,
        provider: "github",
        assist: {
          target_file_or_component: githubAssist.target_file_or_component,
          expected_impact: githubAssist.expected_impact,
          linked_reason_types: githubAssist.linked_reason_types,
        },
      }),
    });
    assert(githubWritePlanRes.statusCode === 201, "github assist write plan should return 201");
    const githubWritePlan = JSON.parse(githubWritePlanRes.body.toString("utf8"));
    assert(githubWritePlan.confirm_required === true, "github write plan should require confirm");
    assert(githubWritePlan.write_plan_record && githubWritePlan.write_plan_record.source_ref.metadata.entrypoint === "run_detail", "github assist write plan should carry common write plan source");
    assert(Array.isArray(githubWritePlan.write_plan_record.target_files) && githubWritePlan.write_plan_record.target_files.length > 0, "github assist write plan should preserve targets");

    const figmaWritePlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-action-assist/corrective-action/write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        action_key: figmaAction.key,
        provider: "figma",
        assist: {
          target_file_or_component: figmaAssist.target_file_or_component,
          expected_impact: figmaAssist.expected_impact,
          linked_reason_types: figmaAssist.linked_reason_types,
        },
      }),
    });
    assert(figmaWritePlanRes.statusCode === 201, "figma assist write plan should return 201");
    const figmaWritePlan = JSON.parse(figmaWritePlanRes.body.toString("utf8"));
    assert(figmaWritePlan.confirm_required === true, "figma write plan should require confirm");
    assert(figmaWritePlan.write_plan_record && Array.isArray(figmaWritePlan.write_plan_record.expected_changes) && figmaWritePlan.write_plan_record.expected_changes.length > 0, "figma assist write plan should preserve expected changes");
    assert(figmaWritePlan.write_plan_record.source_ref && figmaWritePlan.write_plan_record.source_ref.ref_kind === "ai_action_assist", "figma assist write plan should preserve source_ref");
  } finally {
    nock.cleanAll();
    createdRunIds.forEach((id) => db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id));
    createdProjectIds.forEach((id) => db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id));
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiApiKey;
  }
}

module.exports = { run };
