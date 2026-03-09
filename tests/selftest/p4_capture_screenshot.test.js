const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function createRunForCapture(handler, token) {
  const runRes = await requestLocal(handler, {
    method: "POST",
    url: "/api/runs",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_type: "integration_hub.phase1.code_to_figma_from_url",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/capture_test.json",
      inputs: {
        mcp_provider: "local_stub",
        page_url: "https://example.com",
        target_path: ".ai-runs/{{run_id}}/capture_test.json",
      },
    }),
  });
  assert(runRes.statusCode === 201, `run create should return 201, got ${runRes.statusCode}`);
  const payload = JSON.parse(runRes.body.toString("utf8"));
  assert(payload.run_id, "run_id should be returned");
  const parsed = parseRunIdInput(payload.run_id);
  assert(parsed.ok, "run_id should be valid");
  return { publicRunId: payload.run_id, internalRunId: parsed.internalId };
}

async function run() {
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevRunnerMode = process.env.RUNNER_MODE;
  const prevCaptureMock = process.env.CAPTURE_MOCK;
  const prevCaptureForceFail = process.env.CAPTURE_FORCE_FAIL;
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.RUNNER_MODE = "inline";
  process.env.CAPTURE_MOCK = "1";
  delete process.env.CAPTURE_FORCE_FAIL;

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token = `Bearer ${jwtToken}`;

    const run1 = await createRunForCapture(handler, token);

    const captureOkRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/capture/screenshot",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: run1.publicRunId,
        target_url: "https://example.com/",
        viewport: { width: 1280, height: 720 },
        theme: "light",
      }),
    });
    assert(captureOkRes.statusCode === 201, `capture success should return 201, got ${captureOkRes.statusCode}`);
    const captureOk = JSON.parse(captureOkRes.body.toString("utf8"));
    assert(captureOk.failure_code === null, "capture success failure_code must be null");
    assert(typeof captureOk.artifact_path === "string" && captureOk.artifact_path.startsWith(".ai-runs/"), "artifact_path must be under .ai-runs");
    assert(fs.existsSync(path.join(process.cwd(), captureOk.artifact_path)), "capture artifact file should exist");

    const run1DetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${run1.publicRunId}`,
      headers: { Authorization: token },
    });
    assert(run1DetailRes.statusCode === 200, `run detail should return 200, got ${run1DetailRes.statusCode}`);
    const run1Detail = JSON.parse(run1DetailRes.body.toString("utf8"));
    assert(run1Detail.inputs && run1Detail.inputs.capture_request, "run inputs must include capture_request");
    assert(run1Detail.inputs.capture_request.target_url === "https://example.com/", "capture_request target_url must be stored");
    assert(run1Detail.inputs.capture_request.viewport.width === 1280, "capture_request viewport width must be stored");
    assert(
      run1Detail.context_used &&
        run1Detail.context_used.capture_request &&
        run1Detail.context_used.capture_request.viewport.height === 720,
      "context_used capture_request must be stored"
    );
    assert(
      Array.isArray(run1Detail.external_operations) &&
        run1Detail.external_operations.some(
          (entry) =>
            entry &&
            entry.provider === "capture" &&
            entry.operation_type === "capture.screenshot" &&
            entry.result &&
            entry.result.status === "ok"
        ),
      "capture external operation should be appended"
    );

    const run2 = await createRunForCapture(handler, token);
    process.env.CAPTURE_FORCE_FAIL = "1";
    process.env.CAPTURE_MOCK = "0";
    const captureFailRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/capture/screenshot",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: run2.publicRunId,
        target_url: "https://example.com/",
        viewport: { width: 1024, height: 768 },
      }),
    });
    assert(captureFailRes.statusCode === 502, `capture failure should return 502, got ${captureFailRes.statusCode}`);
    const captureFail = JSON.parse(captureFailRes.body.toString("utf8"));
    assert(captureFail.details && captureFail.details.failure_code === "capture_failed", "failure_code must be fixed to capture_failed");

    const run2DetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${run2.publicRunId}`,
      headers: { Authorization: token },
    });
    assert(run2DetailRes.statusCode === 200, `run detail should return 200, got ${run2DetailRes.statusCode}`);
    const run2Detail = JSON.parse(run2DetailRes.body.toString("utf8"));
    assert(
      run2Detail.inputs &&
        run2Detail.inputs.capture_result &&
        run2Detail.inputs.capture_result.failure_code === "capture_failed",
      "run inputs capture_result must store capture_failed"
    );
    assert(
      Array.isArray(run2Detail.external_operations) &&
        run2Detail.external_operations.some(
          (entry) =>
            entry &&
            entry.provider === "capture" &&
            entry.operation_type === "capture.screenshot" &&
            entry.result &&
            entry.result.failure_code === "capture_failed"
        ),
      "failed capture external operation should store capture_failed"
    );

    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id IN (?, ?)").run(DEFAULT_TENANT, run1.internalRunId, run2.internalRunId);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevRunnerMode === undefined) delete process.env.RUNNER_MODE;
    else process.env.RUNNER_MODE = prevRunnerMode;
    if (prevCaptureMock === undefined) delete process.env.CAPTURE_MOCK;
    else process.env.CAPTURE_MOCK = prevCaptureMock;
    if (prevCaptureForceFail === undefined) delete process.env.CAPTURE_FORCE_FAIL;
    else process.env.CAPTURE_FORCE_FAIL = prevCaptureForceFail;
  }
}

module.exports = { run };
