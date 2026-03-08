const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { KINDS, parsePublicIdFor } = require("../../src/id/publicIds");
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
    const docPath = path.join(process.cwd(), "docs", "external-audit-observability-minimum.md");
    assert(fs.existsSync(docPath), "opsx doc should exist");
    const doc = fs.readFileSync(docPath, "utf8");
    assert(doc.includes("誰が実行したか"), "opsx doc should include actor requirement");
    assert(doc.includes("何を読んだか"), "opsx doc should include read requirement");
    assert(doc.includes("何を書こうとしたか"), "opsx doc should include write plan requirement");
    assert(doc.includes("実際どうなったか"), "opsx doc should include actual result requirement");
    assert(doc.includes("Figma"), "opsx doc should include figma requirement");
    assert(doc.includes("redacted"), "opsx doc should include secret redaction requirement");

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
      body: JSON.stringify({ name: "opsx-audit", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const runCreateRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/opsx.json",
        inputs: {
          requested_by: "u-opsx-auditor",
          external_read_plan: {
            actionability: "confirm_required",
            confirm_required: true,
            confirm_required_reason: "secret_token_should_not_leak",
            read_targets: {
              github: { repository: "octocat/hello-world", branch: "main", paths: ["src/index.js"] },
              figma: { file_key: "CutkQD2XudkCe8eJ1jDfkZ", target: { page_id: "1:1", frame_id: "11:22", node_ids: ["11:22:1"] } },
            },
          },
          planned_actions: [
            {
              action_id: "act1",
              provider: "figma",
              operation_type: "figma.apply_changes",
              status: "confirm_required",
              target: { file_key: "CutkQD2XudkCe8eJ1jDfkZ", frame_id: "11:22" },
            },
          ],
          external_operations: [
            {
              provider: "figma",
              operation_type: "figma.apply_changes",
              target: { file_key: "CutkQD2XudkCe8eJ1jDfkZ", frame_id: "11:22", node_ids: ["11:22:1"] },
              result: { status: "error", failure_code: "service_unavailable", reason: "api_token_invalid" },
              artifacts: { fidelity_score: 92.3, fidelity_status: "failed" },
            },
          ],
          fg_validation: {
            status: "failed",
            score_total: 92.3,
            passed: false,
            hard_fail_reasons: ["safety_failed"],
            axes: { safety_rate: 90 },
          },
          figma_before: { file_key: "before", target: { page_id: "1:1", frame_id: "11:22", node_ids: ["11:22:1"] } },
          figma_after: { file_key: "after", target: { page_id: "1:1", frame_id: "11:22", node_ids: ["11:22:1"] } },
        },
      }),
    });
    assert(runCreateRes.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreateRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, runPayload.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const detail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(detail.external_audit && typeof detail.external_audit === "object", "run detail should include external_audit");
    assert(
      typeof detail.external_audit.actor.requested_by === "string" &&
        detail.external_audit.actor.requested_by.length > 0,
      "external_audit should include actor"
    );
    assert(detail.external_audit.scope.project_id === project.id, "external_audit should include project scope");
    assert(detail.external_audit.read.targets.github.repository === "octocat/hello-world", "external_audit should include github read target");
    assert(detail.external_audit.write_plan.length >= 1, "external_audit should include write plan");
    assert(detail.external_audit.write_actual.length >= 1, "external_audit should include write actual");
    assert(detail.external_audit.figma_fidelity && detail.external_audit.figma_fidelity.status === "failed", "external_audit should include figma fidelity");
    assert(
      detail.external_audit.read.confirm_required_reason === "[redacted]",
      "external_audit should redact secret-like text in read reason"
    );
    assert(
      detail.external_audit.write_actual[0].result.reason === "[redacted]",
      "external_audit should redact secret-like text in result reason"
    );

    const projectRunsRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(projectRunsRes.statusCode === 200, "project runs should return 200");
    const projectRuns = JSON.parse(projectRunsRes.body.toString("utf8"));
    const listed = Array.isArray(projectRuns.runs) ? projectRuns.runs.find((row) => row.run_id === runPayload.run_id) : null;
    assert(listed && listed.external_audit, "project runs list should include external_audit");
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
