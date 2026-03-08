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
      body: JSON.stringify({ name: "fg-before-after-api", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/fg-before-after.json",
        inputs: {
          page_url: "https://example.com",
          figma_before: {
            file_key: "before-key",
            target: { page_id: "1:1", page_name: "Landing", frame_id: "10:1", frame_name: "Hero", node_ids: ["10:1"] },
          },
          figma_after: {
            file_key: "after-key",
            target: { page_id: "1:1", page_name: "Landing", frame_id: "10:1", frame_name: "Hero", node_ids: ["10:1"] },
          },
          figma_structure_diff: {
            major_diff_detected: false,
            structural_reproduction: { rate: 0.97, pass: true, status: "good" },
            counts: { target_mismatches: 0, parent_mismatches: 0, auto_layout_mismatches: 1, text_mismatches: 1, component_mismatches: 0 },
          },
          figma_visual_diff: {
            score: 96.4,
            highlights: ["spacing adjusted", "color token aligned"],
          },
        },
      }),
    });
    assert(createRunRes.statusCode === 201, "run create should return 201");
    const run = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, run.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${run.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(runDetail.figma_before_after, "run detail should include figma_before_after");
    assert(runDetail.figma_before_after.before.file_key === "before-key", "before file key should be projected");
    assert(runDetail.figma_before_after.after.file_key === "after-key", "after file key should be projected");
    assert(
      runDetail.figma_before_after.structure_diff_summary.structural_reproduction.rate === 0.97,
      "structure diff summary should be projected"
    );
    assert(runDetail.figma_before_after.visual_diff_summary.score === 96.4, "visual diff summary should be projected");
    assert(runDetail.figma_before_after.major_change_points.length >= 1, "major change points should be present");

    const runsRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runsRes.statusCode === 200, "project runs should return 200");
    const runsBody = JSON.parse(runsRes.body.toString("utf8"));
    const listed = Array.isArray(runsBody.runs) ? runsBody.runs.find((item) => item.run_id === run.run_id) : null;
    assert(listed, "project runs should include created run");
    assert(listed.figma_before_after, "project runs list should include figma_before_after");
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
