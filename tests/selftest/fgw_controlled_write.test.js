const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");
const nock = require("nock");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevWriteToken = process.env.FG_WRITE_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.FG_WRITE_TOKEN = "figma_write_dummy";

  const createdProjectIds = [];
  const createdRunIds = [];
  try {
    nock.disableNetConnect();
    nock.enableNetConnect("127.0.0.1");
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
      body: JSON.stringify({ name: "fgw-controlled-write", staging_url: "https://example.com" }),
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
        figma_file_key: "CutkQD2XudkCe8eJ1jDfkZ",
        figma_secret_id: "vault://figma/tokens/fgw-01",
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
        target_path: ".ai-runs/{{run_id}}/fg-write.json",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(runCreateRes.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreateRes.body.toString("utf8"));
    const parsedRun = parseRunIdInput(runPayload.run_id);
    assert(parsedRun.ok, "run id should be valid");
    createdRunIds.push(parsedRun.internalId);

    const blockedFrameRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        frame_id: "11:23",
        change_type: "update",
      }),
    });
    assert(blockedFrameRes.statusCode === 400, "frame outside allowed scope should be rejected");

    const ambiguousTargetRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        page_name: "Landing",
        change_type: "update",
      }),
    });
    assert(ambiguousTargetRes.statusCode === 400, "ambiguous target should be rejected");

    const writePlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write-plan",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        change_type: "update",
      }),
    });
    assert(writePlanRes.statusCode === 201, "figma write plan should return 201");
    const writePlan = JSON.parse(writePlanRes.body.toString("utf8"));
    assert(writePlan.operation_type === "figma.apply_changes", "operation type should be figma.apply_changes");
    assert(writePlan.target && writePlan.target.frame_id === "11:22", "target frame should be resolved from project settings");
    assert(typeof writePlan.confirm_required_reason === "string" && writePlan.confirm_required_reason.length > 0, "confirm reason should exist");

    const confirmRequiredRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        change_type: "text_update",
        node_id: "11:22:node1",
        text: "updated text",
      }),
    });
    assert(confirmRequiredRes.statusCode === 202, "figma write should require confirm");
    const confirmRequired = JSON.parse(confirmRequiredRes.body.toString("utf8"));
    assert(confirmRequired.status === "confirm_required", "status should be confirm_required");
    assert(confirmRequired.planned_action && typeof confirmRequired.planned_action.action_id === "string", "planned action id is required");

    nock("https://api.figma.com")
      .get("/v1/files/CutkQD2XudkCe8eJ1jDfkZ")
      .times(2)
      .reply(200, {
        version: "file-version-1",
        lastModified: "2026-03-01T00:00:00Z",
      })
      .post("/v1/files/CutkQD2XudkCe8eJ1jDfkZ/nodes:batch_update")
      .reply(200, {
        version: "file-version-2",
        lastModified: "2026-03-08T00:00:00Z",
        updated_node_ids: ["11:22:node1"],
      });
    const confirmedRes2 = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        change_type: "text_update",
        node_id: "11:22:node1",
        text: "updated text",
        figma_secret_id: "env://FG_WRITE_TOKEN",
        confirm: true,
        planned_action_id: confirmRequired.planned_action.action_id,
        confirm_token: confirmRequired.confirm_token,
      }),
    });
    assert(confirmedRes2.statusCode === 201, "confirmed figma write should return 201");
    const confirmed = JSON.parse(confirmedRes2.body.toString("utf8"));
    assert(confirmed.status === "success", "write status should be success");
    assert(confirmed.before_after && confirmed.before_after.before && confirmed.before_after.after, "before_after should be returned");
    assert(confirmed.fidelity_result && confirmed.fidelity_result.status === "ok", "fidelity result should be returned");

    const lowSafetyPlanRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        change_type: "text_update",
        node_id: "11:22:node1",
        text: "updated text 2",
      }),
    });
    assert(lowSafetyPlanRes.statusCode === 202, "second write should require confirm");
    const lowSafetyPlan = JSON.parse(lowSafetyPlanRes.body.toString("utf8"));
    nock("https://api.figma.com")
      .get("/v1/files/CutkQD2XudkCe8eJ1jDfkZ")
      .times(2)
      .reply(200, {
        version: "file-version-2",
        lastModified: "2026-03-08T00:00:00Z",
      })
      .post("/v1/files/CutkQD2XudkCe8eJ1jDfkZ/nodes:batch_update")
      .reply(200, {
        version: "file-version-3",
        lastModified: "2026-03-08T00:01:00Z",
        updated_node_ids: ["11:22:node1"],
      });
    const lowSafetyConfirmRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/write",
      headers: authz,
      body: JSON.stringify({
        run_id: runPayload.run_id,
        page_id: "1:1",
        change_type: "text_update",
        node_id: "11:22:node1",
        text: "updated text 2",
        figma_secret_id: "env://FG_WRITE_TOKEN",
        safety_score: 90,
        confirm: true,
        planned_action_id: lowSafetyPlan.planned_action.action_id,
        confirm_token: lowSafetyPlan.confirm_token,
      }),
    });
    assert(lowSafetyConfirmRes.statusCode === 422, "safety below threshold should fail acceptance");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const detail = JSON.parse(runDetailRes.body.toString("utf8"));
    const figmaOps = Array.isArray(detail.external_operations)
      ? detail.external_operations.filter((entry) => entry && entry.provider === "figma" && entry.operation_type === "figma.apply_changes")
      : [];
    assert(figmaOps.some((entry) => entry.result && entry.result.status === "ok"), "figma write success should be tracked");
    assert(
      figmaOps.some((entry) => entry.result && entry.result.failure_code === "fidelity_below_threshold"),
      "fidelity threshold failure should be tracked"
    );
    assert(figmaOps.some((entry) => entry.artifacts && typeof entry.artifacts.fidelity_score === "number"), "figma fidelity should be tracked");
    assert(detail.figma_before_after && detail.figma_before_after.before && detail.figma_before_after.after, "run should project figma before_after");
    assert(detail.figma_before_after.visual_diff_summary && typeof detail.figma_before_after.visual_diff_summary.score === "number", "visual diff summary should be projected");

    const workspaceUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-workspace.html"), "utf8");
    assert(workspaceUi.includes("Figma op:"), "workspace UI should include figma operation summary text");
    assert(workspaceUi.includes("Figma before/after:"), "workspace UI should include figma before/after summary text");
    assert(workspaceUi.includes("External Reference Context"), "workspace UI should include external reference context section");
    assert(workspaceUi.includes("workspace-external-context"), "workspace UI should include external context container");
    assert(workspaceUi.includes("workspace-op-plan-btn"), "workspace UI should include external operation plan button");
    assert(workspaceUi.includes("workspace-op-confirm-btn"), "workspace UI should include external operation confirm button");
    assert(workspaceUi.includes("workspace-op-read-preview"), "workspace UI should include read target preview");
    assert(workspaceUi.includes("workspace-op-plan-preview"), "workspace UI should include write plan preview");
    assert(workspaceUi.includes("総合95点"), "workspace UI should include figma fidelity caution");
    assert(workspaceUi.includes("External Operation Timeline"), "workspace UI should include external operation timeline section");
    assert(workspaceUi.includes("workspace-op-timeline"), "workspace UI should include external operation timeline container");
    const runUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/run.html"), "utf8");
    assert(runUi.includes("run-figma-operations"), "run UI should include figma operations section");
    const projectRunsUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/ui/project-runs.html"), "utf8");
    assert(projectRunsUi.includes("figma operation"), "project runs UI should include figma operation column");
    const legacyRunUi = fs.readFileSync(path.join(process.cwd(), "apps/hub/static/run.html"), "utf8");
    assert(legacyRunUi.includes("Figma Operations"), "legacy run UI should include figma operations card");
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
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
    if (prevWriteToken === undefined) delete process.env.FG_WRITE_TOKEN;
    else process.env.FG_WRITE_TOKEN = prevWriteToken;
  }
}

module.exports = { run };
