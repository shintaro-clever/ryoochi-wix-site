const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function createRun(handler, token) {
  const res = await requestLocal(handler, {
    method: "POST",
    url: "/api/runs",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_type: "integration_hub.phase1.code_to_figma_from_url",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/corrective_action_assist_test.json",
      inputs: {
        mcp_provider: "local_stub",
        page_url: "https://example.com",
        target_path: ".ai-runs/{{run_id}}/corrective_action_assist_test.json",
        structure_diff: {
          threshold: 0.95,
          structural_reproduction: { rate: 0.9, status: "bad" },
          diffs: {
            reasons: [
              { axis: "structure", reason_code: "instance_variant_changed", node_id: "cta" },
              { axis: "structure", reason_code: "slot_changed", node_id: "hero" },
            ],
          },
        },
        visual_diff: {
          threshold: 95,
          score: 88,
          status: "bad",
          reasons: [{ axis: "visual", reason_code: "color_changed", node_id: "cta" }],
        },
        behavior_diff: {
          threshold: 95,
          score: 80,
          status: "bad",
          reasons: [{ axis: "behavior", reason_code: "missing_state_candidate", state: "loading" }],
        },
        execution_diff: {
          threshold: 95,
          score: 85,
          status: "bad",
          environment_only_mismatch: true,
          reasons: [{ axis: "execution", reason_code: "environment_only_mismatch" }],
        },
      },
    }),
  });
  assert(res.statusCode === 201, `run create should return 201, got ${res.statusCode}`);
  const body = JSON.parse(res.body.toString("utf8"));
  const parsed = parseRunIdInput(body.run_id);
  assert(parsed.ok, "run id should be valid");
  return { publicRunId: body.run_id, internalRunId: parsed.internalId };
}

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  const prevRunnerMode = process.env.RUNNER_MODE;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-corrective-assist";
  process.env.RUNNER_MODE = "inline";

  const userId = `u-${crypto.randomUUID()}`;
  let created = null;
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token = `Bearer ${jwtToken}`;
    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    created = await createRun(handler, token);

    const planRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-plan",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: created.publicRunId }),
    });
    assert(planRes.statusCode === 200, `corrective action plan should return 200, got ${planRes.statusCode}`);
    const planBody = JSON.parse(planRes.body.toString("utf8"));
    const targetAction = planBody.corrective_action_plan.actions.find((item) => item.category === "component_swap");
    assert(targetAction, "component_swap action should exist");

    nock("https://api.openai.com")
      .post("/v1/responses")
      .reply(200, (_uri, reqBody) => {
        const body = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
        const text = JSON.stringify(body);
        assert(!text.includes("confirm_token"), "assist request should not leak confirm token");
        return {
          output_text: JSON.stringify({
            target_file_or_component: ["src/fidelity/componentMap.js", "approved component variant binding"],
            expected_impact: ["variant drift should reduce", "revalidation can focus on the CTA component path"],
            confidence: "medium",
            confirm_required: true,
            linked_reason_types: ["component_variant_mismatch"],
          }),
          usage: { input_tokens: 20, output_tokens: 18, total_tokens: 38 },
        };
      });

    const assistRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai-action-assist/corrective-action",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: created.publicRunId,
        action_key: targetAction.key,
      }),
    });
    assert(assistRes.statusCode === 200, `corrective action assist should return 200, got ${assistRes.statusCode}`);
    const assistBody = JSON.parse(assistRes.body.toString("utf8"));
    assert(assistBody.use_case === "corrective_action_assist", "assist use_case should match");
    assert(assistBody.action_type === "component_swap", "action_type should echo selected category");
    assert(Array.isArray(assistBody.target_file_or_component) && assistBody.target_file_or_component.length > 0, "targets should exist");
    assert(Array.isArray(assistBody.expected_impact) && assistBody.expected_impact.length > 0, "expected impact should exist");
    assert(assistBody.confirm_required === true, "confirm_required should stay true");
    assert(
      Array.isArray(assistBody.linked_reason_types) && assistBody.linked_reason_types.includes("component_variant_mismatch"),
      "linked reason types should include component_variant_mismatch"
    );
    assert(assistBody.evidence_refs.run_id === created.publicRunId, "evidence should preserve run_id");
  } finally {
    nock.cleanAll();
    if (created) db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.internalRunId);
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiApiKey;
    if (prevRunnerMode === undefined) delete process.env.RUNNER_MODE;
    else process.env.RUNNER_MODE = prevRunnerMode;
  }
}

module.exports = { run };
