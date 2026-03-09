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
      target_path: ".ai-runs/{{run_id}}/behavior_test.json",
      inputs: {
        mcp_provider: "local_stub",
        page_url: "https://example.com",
        target_path: ".ai-runs/{{run_id}}/behavior_test.json",
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

    const baselineStates = [
      { state: "hover", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "Hover" }, signature: "hover:v1" },
      { state: "active", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "Active" }, signature: "active:v1" },
      { state: "disabled", attributes: { visible: true, enabled: false, loading: false, modal_open: false, text: "Disabled" }, signature: "disabled:v1" },
      { state: "loading", attributes: { visible: true, enabled: false, loading: true, modal_open: false, text: "Loading" }, signature: "loading:v1" },
      { state: "modal_open", attributes: { visible: true, enabled: true, loading: false, modal_open: true, text: "Modal Open" }, signature: "modal:v1" },
    ];
    const candidateStates = [
      { state: "hover", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "Hover" }, signature: "hover:v1" },
      { state: "active", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "Active Changed" }, signature: "active:v2" },
      { state: "disabled", attributes: { visible: true, enabled: false, loading: false, modal_open: false, text: "Disabled" }, signature: "disabled:v1" },
      { state: "loading", attributes: { visible: true, enabled: false, loading: true, modal_open: false, text: "Loading" }, signature: "loading:v1" },
      { state: "modal_open", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "Modal Open" }, signature: "modal:v2" },
    ];

    const diffRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/behavior-diff",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: created.publicRunId,
        baseline_states: baselineStates,
        candidate_states: candidateStates,
        threshold: 95,
      }),
    });
    assert(diffRes.statusCode === 200, `behavior diff should return 200, got ${diffRes.statusCode}`);
    const diffBody = JSON.parse(diffRes.body.toString("utf8"));
    assert(diffBody.behavior_diff, "behavior_diff should be returned");
    assert(Array.isArray(diffBody.behavior_diff.state_results), "state_results should be array");
    assert(diffBody.behavior_diff.state_results.length === 5, "state_results should include required states");
    assert(diffBody.failure_code === "behavior_diff_below_threshold", "failure_code should be fixed for below threshold");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${created.publicRunId}`,
      headers: { Authorization: token },
    });
    assert(runDetailRes.statusCode === 200, `run detail should return 200, got ${runDetailRes.statusCode}`);
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(runDetail.inputs && runDetail.inputs.behavior_diff, "run inputs should store behavior_diff");
    assert(runDetail.context_used && runDetail.context_used.behavior_diff, "context_used should store behavior_diff");
    assert(
      Array.isArray(runDetail.inputs.behavior_diff.state_results) &&
        runDetail.inputs.behavior_diff.state_results.some((item) => item.state === "modal_open"),
      "modal_open state result should be saved"
    );
    assert(
      Array.isArray(runDetail.external_operations) &&
        runDetail.external_operations.some(
          (entry) =>
            entry &&
            entry.provider === "fidelity" &&
            entry.operation_type === "fidelity.behavior_diff"
        ),
      "behavior diff operation should be tracked"
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
