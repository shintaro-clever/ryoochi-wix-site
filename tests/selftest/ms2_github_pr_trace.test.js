const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token = `Bearer ${jwtToken}`;

    const ingestRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ingest/figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: `trace-${Date.now()}.json`,
        json: { figma_file_key: "FIGMA_TRACE_KEY", title: "trace" },
      }),
    });
    assert(ingestRes.statusCode === 201, "ingest should return 201");
    const ingested = JSON.parse(ingestRes.body.toString("utf8"));

    const runCreate = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        job_type: "integration_hub.phase2.repo_patch",
        run_mode: "mcp",
        target_path: ".ai-runs/{{run_id}}/trace.json",
        inputs: {
          message: "trace",
          target_path: ".ai-runs/{{run_id}}/trace.json",
        },
      }),
    });
    assert(runCreate.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreate.body.toString("utf8"));
    assert(runPayload.run_id, "run_id should exist");
    const parsedRunId = parseRunIdInput(runPayload.run_id);
    assert(parsedRunId.ok, "run_id should be public run ID");
    const internalRunId = parsedRunId.internalId;

    const fromFigma = await requestLocal(handler, {
      method: "POST",
      url: "/api/jobs/from-figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        ingest_artifact_path: ingested.artifact_path,
      }),
    });
    assert(fromFigma.statusCode === 201, "jobs from figma should return 201");

    const runDetail = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: token },
    });
    assert(runDetail.statusCode === 200, "run detail should return 200");
    const detail = JSON.parse(runDetail.body.toString("utf8"));
    assert(detail.figma_file_key === "FIGMA_TRACE_KEY", "run should store figma_file_key trace");
    assert(detail.ingest_artifact_path === ingested.artifact_path, "run should store ingest_artifact_path trace");
    assert(Array.isArray(detail.external_operations), "external_operations should exist");
    assert(
      detail.external_operations.some(
        (entry) =>
          entry &&
          entry.provider === "figma" &&
          entry.operation_type === "figma.plan_from_ingest" &&
          entry.result &&
          entry.result.status === "ok"
      ),
      "figma plan operation should be recorded"
    );

    const dryRunPr = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "example",
        repo: "demo",
        title: "dry-run-pr",
        dry_run: true,
      }),
    });
    assert(dryRunPr.statusCode === 201, "github pr dry-run should return 201");
    const dryPayload = JSON.parse(dryRunPr.body.toString("utf8"));
    assert(dryPayload.dry_run === true, "dry-run flag should be true");

    const planPr = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "example",
        repo: "demo",
        title: "real-pr-attempt",
        github_token: "dummy-token",
        dry_run: false,
        file_path: "vault/tmp/hub-generated.txt",
        write_path_allowlist: ["vault/tmp"],
      }),
    });
    assert(planPr.statusCode === 202, "github write should return confirm_required before execution");
    const planPayload = JSON.parse(planPr.body.toString("utf8"));
    assert(planPayload.status === "confirm_required", "planned action status should be confirm_required");
    assert(planPayload.planned_action && typeof planPayload.planned_action.action_id === "string", "planned action id should exist");
    assert(typeof planPayload.confirm_token === "string" && planPayload.confirm_token.length > 10, "confirm token should exist");

    const confirmPr = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "example",
        repo: "demo",
        title: "real-pr-attempt",
        github_token: "dummy-token",
        dry_run: false,
        file_path: "vault/tmp/hub-generated.txt",
        write_path_allowlist: ["vault/tmp"],
        confirm: true,
        planned_action_id: planPayload.planned_action.action_id,
        confirm_token: planPayload.confirm_token,
      }),
    });
    assert([401, 503].includes(confirmPr.statusCode), "confirmed github pr call should fail clearly in test env");
    const errPayload = JSON.parse(confirmPr.body.toString("utf8"));
    assert(typeof errPayload.message === "string", "error.message should exist");
    assert(typeof errPayload.message_en === "string", "error.message_en should exist");
    assert(errPayload.details && typeof errPayload.details.failure_code === "string", "failure_code should exist");

    const runDetailAfterOps = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: token },
    });
    assert(runDetailAfterOps.statusCode === 200, "run detail after operations should return 200");
    const detailAfterOps = JSON.parse(runDetailAfterOps.body.toString("utf8"));
    const githubOps = Array.isArray(detailAfterOps.external_operations)
      ? detailAfterOps.external_operations.filter((entry) => entry && entry.provider === "github")
      : [];
    assert(githubOps.length >= 3, "github operations should include dry-run, planned confirm-required and failure");
    assert(
      githubOps.some((entry) => entry.operation_type === "github.create_pr" && entry.result.status === "skipped"),
      "github dry-run operation should be recorded as skipped"
    );
    assert(
      githubOps.some(
        (entry) =>
          entry.operation_type === "github.create_pr" &&
          entry.result.status === "skipped" &&
          entry.result.reason === "confirm_required"
      ),
      "github planned action should be recorded as confirm_required"
    );
    assert(
      githubOps.some(
        (entry) =>
          entry.operation_type === "github.create_pr" &&
          entry.result.status === "error" &&
          typeof entry.result.failure_code === "string"
      ),
      "github failed operation should record failure_code"
    );
    assert(Array.isArray(detailAfterOps.planned_actions), "planned_actions should be exposed on run");
    assert(
      detailAfterOps.planned_actions.some(
        (entry) =>
          entry &&
          entry.provider === "github" &&
          entry.operation_type === "github.create_pr" &&
          entry.status === "confirmed"
      ),
      "planned action should move to confirmed after confirm call"
    );

    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, internalRunId);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
