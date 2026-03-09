const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
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
      target_path: ".ai-runs/{{run_id}}/corrective_action_plan_test.json",
      inputs: {
        mcp_provider: "local_stub",
        page_url: "https://example.com",
        target_path: ".ai-runs/{{run_id}}/corrective_action_plan_test.json",
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
          reasons: [
            { axis: "visual", reason_code: "color_changed", node_id: "cta" },
          ],
        },
        behavior_diff: {
          threshold: 95,
          score: 80,
          status: "bad",
          reasons: [
            { axis: "behavior", reason_code: "missing_state_candidate", state: "loading" },
          ],
        },
        execution_diff: {
          threshold: 95,
          score: 85,
          status: "bad",
          environment_only_mismatch: true,
          reasons: [
            { axis: "execution", reason_code: "environment_only_mismatch" },
          ],
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
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevRunnerMode = process.env.RUNNER_MODE;
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.RUNNER_MODE = "inline";

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token = `Bearer ${jwtToken}`;

    const created = await createRun(handler, token);

    const planRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/corrective-action-plan",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: created.publicRunId,
      }),
    });

    assert(planRes.statusCode === 200, `corrective action plan should return 200, got ${planRes.statusCode}`);
    const planBody = JSON.parse(planRes.body.toString("utf8"));
    assert(planBody.corrective_action_plan, "corrective_action_plan should be returned");
    assert(planBody.corrective_action_plan.summary.total_actions >= 4, "plan should contain grouped actions");
    assert(
      planBody.corrective_action_plan.actions.some((item) => item.category === "state_addition"),
      "state_addition action should exist"
    );
    assert(
      planBody.corrective_action_plan.actions.some((item) => item.category === "component_swap"),
      "component_swap action should exist"
    );
    assert(
      planBody.corrective_action_plan.actions.some((item) => item.category === "environment_alignment"),
      "environment_alignment action should exist"
    );

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${created.publicRunId}`,
      headers: { Authorization: token },
    });
    assert(runDetailRes.statusCode === 200, `run detail should return 200, got ${runDetailRes.statusCode}`);
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));

    assert(runDetail.inputs && runDetail.inputs.corrective_action_plan, "run inputs should store corrective_action_plan");
    assert(
      runDetail.context_used && runDetail.context_used.corrective_action_plan,
      "context_used should store corrective_action_plan"
    );
    assert(
      Array.isArray(runDetail.external_operations) &&
        runDetail.external_operations.some(
          (entry) =>
            entry &&
            entry.provider === "fidelity" &&
            entry.operation_type === "fidelity.corrective_action_plan"
        ),
      "corrective action plan operation should be tracked"
    );

    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.internalRunId);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevRunnerMode === undefined) delete process.env.RUNNER_MODE;
    else process.env.RUNNER_MODE = prevRunnerMode;
  }
}

module.exports = { run };
