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
      target_path: ".ai-runs/{{run_id}}/execution_test.json",
      inputs: {
        mcp_provider: "local_stub",
        page_url: "https://example.com",
        target_path: ".ai-runs/{{run_id}}/execution_test.json",
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

    const baselineExecution = {
      font_fallback: ["Noto Sans", "Arial"],
      viewport: { width: 1440, height: 900 },
      theme: "light",
      data_state: "seed:v1",
      browser: { name: "chromium", version: "125", engine: "blink" },
      runtime_status: "ok",
      network_contract_status: "ok",
      performance_guardrail_status: "ok",
    };

    const candidateExecution = {
      font_fallback: ["Arial", "Helvetica Neue"],
      viewport: { width: 1280, height: 720 },
      theme: "dark",
      data_state: "seed:v2",
      browser: { name: "chromium", version: "126", engine: "blink" },
      runtime_status: "ok",
      network_contract_status: "ok",
      performance_guardrail_status: "ok",
    };

    const diffRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/fidelity/execution-diff",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: created.publicRunId,
        baseline_execution: baselineExecution,
        candidate_execution: candidateExecution,
        threshold: 95,
      }),
    });

    assert(diffRes.statusCode === 200, `execution diff should return 200, got ${diffRes.statusCode}`);
    const diffBody = JSON.parse(diffRes.body.toString("utf8"));
    assert(diffBody.execution_diff, "execution_diff should be returned");
    assert(diffBody.execution_diff.environment_only_mismatch === true, "environment_only_mismatch should be true");
    assert(diffBody.failure_code === "execution_diff_environment_only_mismatch", "failure_code should classify environment only mismatch");
    assert(
      Array.isArray(diffBody.execution_diff.reasons) &&
        diffBody.execution_diff.reasons.some((item) => item.reason_code === "environment_only_mismatch"),
      "environment_only_mismatch reason should exist"
    );
    assert(
      Array.isArray(diffBody.execution_diff.mismatch_fields.environment) &&
        diffBody.execution_diff.mismatch_fields.environment.includes("font_fallback") &&
        diffBody.execution_diff.mismatch_fields.environment.includes("viewport") &&
        diffBody.execution_diff.mismatch_fields.environment.includes("theme") &&
        diffBody.execution_diff.mismatch_fields.environment.includes("data_state") &&
        diffBody.execution_diff.mismatch_fields.environment.includes("browser"),
      "all required environment fields must be recorded"
    );

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${created.publicRunId}`,
      headers: { Authorization: token },
    });
    assert(runDetailRes.statusCode === 200, `run detail should return 200, got ${runDetailRes.statusCode}`);
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));

    assert(runDetail.inputs && runDetail.inputs.execution_diff, "run inputs should store execution_diff");
    assert(runDetail.context_used && runDetail.context_used.execution_diff, "context_used should store execution_diff");
    assert(runDetail.inputs && runDetail.inputs.fidelity_reasons, "run inputs should store fidelity_reasons");
    assert(runDetail.context_used && runDetail.context_used.fidelity_reasons, "context_used should store fidelity_reasons");
    assert(
      runDetail.context_used.fidelity_reasons.counts &&
        runDetail.context_used.fidelity_reasons.counts.by_type &&
        runDetail.context_used.fidelity_reasons.counts.by_type.environment_only_mismatch >= 1,
      "fidelity_reasons should classify environment-only mismatch"
    );
    assert(
      runDetail.inputs.execution_diff.candidate &&
        runDetail.inputs.execution_diff.candidate.browser &&
        runDetail.inputs.execution_diff.candidate.browser.version === "126",
      "candidate browser should be recorded"
    );
    assert(
      Array.isArray(runDetail.external_operations) &&
        runDetail.external_operations.some(
          (entry) =>
            entry &&
            entry.provider === "fidelity" &&
            entry.operation_type === "fidelity.execution_diff"
        ),
      "execution diff operation should be tracked"
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
