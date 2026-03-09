const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun } = require("../../src/api/runs");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

function createFixtureRun(projectId, inputs) {
  return createRun(db, {
    project_id: projectId,
    job_type: "integration_hub.phase1.code_to_figma_from_url",
    run_mode: "mcp",
    target_path: ".ai-runs/{{run_id}}/p4_fidelity_metrics.json",
    inputs: {
      page_url: "https://example.com",
      ...inputs,
    },
  });
}

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
      body: JSON.stringify({ name: "p4-fidelity-metrics", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    createdRunIds.push(createFixtureRun(parsedProject.internalId, {
      connection_context: {
        figma: {
          node_summaries: [
            { id: "10:1", name: "Button/Primary", component_kind: "instance" },
            { id: "10:2", name: "Hero/Card", component_kind: "component" },
          ],
        },
      },
      fidelity_environment: { target_environment: "staging" },
      structure_diff: { structural_reproduction: { rate: 0.98, status: "good" } },
      visual_diff: { score: 96, status: "good", reasons: [{ reason_code: "color_changed" }] },
      behavior_diff: { score: 97, status: "good", reasons: [] },
      execution_diff: { score: 95, status: "good", reasons: [] },
      phase4_score: {
        final_score: 97,
        threshold: 95,
        status: "passed",
      },
    }));

    createdRunIds.push(createFixtureRun(parsedProject.internalId, {
      connection_context: {
        figma: {
          node_summaries: [
            { id: "20:1", name: "Button/Primary", component_kind: "instance" },
            { id: "20:2", name: "Modal/Dialog", component_kind: "instance" },
          ],
        },
      },
      fidelity_environment: { target_environment: "production" },
      structure_diff: {
        structural_reproduction: { rate: 0.9, status: "bad" },
        diffs: { reasons: [{ reason_code: "slot_changed" }] },
      },
      visual_diff: { score: 89, status: "bad", reasons: [{ reason_code: "spacing_changed" }] },
      behavior_diff: { score: 92, status: "bad", reasons: [] },
      execution_diff: {
        score: 93,
        status: "bad",
        reasons: [{ reason_code: "environment_only_mismatch" }],
      },
      phase4_score: {
        final_score: 91,
        threshold: 95,
        status: "failed",
      },
    }));

    createdRunIds.push(createFixtureRun(parsedProject.internalId, {
      connection_context: {
        figma: {
          node_summaries: [
            { id: "30:1", name: "Hero/Card", component_kind: "component" },
          ],
        },
      },
      fidelity_environment: { target_environment: "production" },
      structure_diff: {
        structural_reproduction: { rate: 0.87, status: "bad" },
        diffs: { reasons: [{ reason_code: "instance_variant_changed" }] },
      },
      visual_diff: { score: 86, status: "bad", reasons: [] },
      behavior_diff: { score: 90, status: "bad", reasons: [] },
      execution_diff: { score: 89, status: "bad", reasons: [] },
      phase4_score: {
        final_score: 88,
        threshold: 95,
        status: "failed",
      },
    }));

    const res = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(res.statusCode === 200, `project runs should return 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body.toString("utf8"));
    assert(Array.isArray(body.runs) && body.runs.length === 3, "runs should be returned");
    assert(body.fidelity_metrics, "fidelity_metrics should be returned");
    assert(body.fidelity_metrics.averages && typeof body.fidelity_metrics.averages.final === "number", "average final score should exist");
    assert(
      body.fidelity_metrics.score_progress && body.fidelity_metrics.score_progress.below_95_rate > 0,
      "below 95 rate should be aggregated"
    );
    assert(
      Array.isArray(body.fidelity_metrics.top_reasons) &&
        body.fidelity_metrics.top_reasons.some((entry) => entry.reason_type === "component_variant_mismatch"),
      "top reasons should include aggregated reason types"
    );
    assert(
      Array.isArray(body.fidelity_metrics.environment_failure_rates) &&
        body.fidelity_metrics.environment_failure_rates.some(
          (entry) => entry.environment === "production" && entry.failed_rate > 0
        ),
      "environment failure rates should be aggregated"
    );
    assert(
      Array.isArray(body.fidelity_metrics.component_failure_rates) &&
        body.fidelity_metrics.component_failure_rates.some(
          (entry) => entry.component === "Button/Primary" && entry.failed_rate > 0
        ),
      "component failure rates should be aggregated"
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
