const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

function buildFigmaFilePayload() {
  return {
    name: "Context Design",
    lastModified: "2026-03-08T12:00:00Z",
    version: "v1",
    editorType: "figma",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Doc",
      children: [
        {
          id: "1:1",
          type: "CANVAS",
          name: "Landing",
          children: [
            {
              id: "10:1",
              type: "FRAME",
              name: "Hero",
              layoutMode: "HORIZONTAL",
              primaryAxisSizingMode: "AUTO",
              counterAxisSizingMode: "FIXED",
              itemSpacing: 16,
              absoluteBoundingBox: { width: 1000, height: 320 },
              children: [
                {
                  id: "10:2",
                  type: "TEXT",
                  name: "Title",
                  characters: "Context hello",
                  absoluteBoundingBox: { width: 200, height: 40 },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevFigmaToken = process.env.FG_CTX_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.FG_CTX_TOKEN = "figma_ctx_dummy_token";

  const createdProjectIds = [];
  const createdRunIds = [];
  const createdThreadIds = [];

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
      body: JSON.stringify({ name: "fg-ctx-run-chat", staging_url: "https://example.com" }),
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
        figma_file_key: "CtxAbCdEf1234",
        figma_secret_id: "env://FG_CTX_TOKEN",
        figma_page_scope: "page:Landing",
        figma_frame_scope: "frame:Hero",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "project settings put should return 200");

    nock("https://api.figma.com")
      .get("/v1/files/CtxAbCdEf1234")
      .times(2)
      .reply(200, buildFigmaFilePayload());

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/fg-context-run.json",
        figma_node_ids: ["10:2"],
        figma_writable_scope: "node",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunRes.statusCode === 201, "run create should return 201");
    const createdRun = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, createdRun.run_id);
    assert(parsedRun.ok, "run id should be public");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    const figmaCtx = runDetail.inputs?.connection_context?.figma;
    assert(figmaCtx, "run should include connection_context.figma");
    assert(figmaCtx.status === "ok", "figma context status should be ok");
    assert(figmaCtx.file_key === "CtxAbCdEf1234", "figma file_key should be present");
    assert(figmaCtx.last_modified === "2026-03-08T12:00:00Z", "figma last_modified should be present");
    assert(figmaCtx.target.page_id === "1:1", "resolved page id should be present");
    assert(figmaCtx.target.frame_id === "10:1", "resolved frame id should be present");
    assert(figmaCtx.target_selection_source.page === "project_default", "page source should be project_default");
    assert(figmaCtx.target_selection_source.frame === "project_default", "frame source should be project_default");
    assert(figmaCtx.target_selection_source.writable_scope === "run_override", "writable scope source should be run_override");
    assert(Array.isArray(figmaCtx.node_summaries) && figmaCtx.node_summaries.length === 1, "node summaries should exist");
    assert(figmaCtx.layout_summary.node_count >= 1, "layout summary should include node count");
    assert(figmaCtx.writable_scope === "node", "writable_scope should match run override");
    assert(figmaCtx.write_guard.requires_confirmation === false, "write guard should allow node-scoped target");
    assert(
      runDetail.context_used?.connection_context?.figma?.layout_summary?.text_node_count >= 1,
      "context_used should include figma layout/text summary"
    );
    assert(runDetail.external_references_snapshot?.figma?.file_key === "CtxAbCdEf1234", "figma snapshot file key should be stored");
    assert(runDetail.external_references_snapshot?.figma?.target?.page_id === "1:1", "figma snapshot page id should be stored");
    assert(runDetail.external_references_snapshot?.figma?.target?.frame_id === "10:1", "figma snapshot frame id should be stored");
    assert(
      Array.isArray(runDetail.external_references_snapshot?.figma?.target?.node_ids) &&
        runDetail.external_references_snapshot.figma.target.node_ids.includes("10:2"),
      "figma snapshot node ids should be stored"
    );
    assert(
      Array.isArray(runDetail.external_references_snapshot?.figma?.resolved_target_paths) &&
        runDetail.external_references_snapshot.figma.resolved_target_paths.some((entry) => entry.includes("frame/10:1")),
      "figma snapshot should include resolved target paths"
    );

    const workspaceRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({
        content: "check figma context",
      }),
    });
    assert(workspaceRes.statusCode === 201, "workspace message should return 201");
    const workspaceBody = JSON.parse(workspaceRes.body.toString("utf8"));
    const parsedWorkspaceRun = parsePublicIdFor(KINDS.run, workspaceBody.run_id);
    const parsedWorkspaceThread = parsePublicIdFor(KINDS.thread, workspaceBody.thread_id);
    assert(parsedWorkspaceRun.ok, "workspace run id should be public");
    assert(parsedWorkspaceThread.ok, "workspace thread id should be public");
    createdRunIds.push(parsedWorkspaceRun.internalId);
    createdThreadIds.push(parsedWorkspaceThread.internalId);

    const workspaceRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${workspaceBody.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(workspaceRunDetailRes.statusCode === 200, "workspace run detail should return 200");
    const workspaceRunDetail = JSON.parse(workspaceRunDetailRes.body.toString("utf8"));
    const workspaceFigmaCtx = workspaceRunDetail.inputs?.connection_context?.figma;
    assert(workspaceFigmaCtx, "workspace run should include figma context");
    assert(workspaceFigmaCtx.status === "ok", "workspace figma status should be ok");
    assert(workspaceFigmaCtx.target.page_name === "Landing", "workspace figma target should be normalized");
    assert(workspaceFigmaCtx.layout_summary.node_count >= 1, "workspace layout summary should be present");
    assert(workspaceRunDetail.external_references_snapshot?.figma?.file_key === "CtxAbCdEf1234", "workspace run should store figma snapshot");

    const createProjectRes2 = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "fg-ctx-write-guard", staging_url: "https://example.com" }),
    });
    assert(createProjectRes2.statusCode === 201, "second project create should return 201");
    const project2 = JSON.parse(createProjectRes2.body.toString("utf8"));
    const parsedProject2 = parsePublicIdFor(KINDS.project, project2.id);
    assert(parsedProject2.ok, "second project id should be public");
    createdProjectIds.push(parsedProject2.internalId);

    const putSettingsRes2 = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project2.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        figma_file_key: "CtxAbCdEf1234",
        figma_secret_id: "env://FG_CTX_TOKEN",
        figma_writable_scope: "frame",
      }),
    });
    assert(putSettingsRes2.statusCode === 200, "second project settings put should return 200");

    const ambiguousScopeRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project2.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/fg-context-ambiguous.json",
        figma_frame_scope: "frame:Hero",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(ambiguousScopeRunRes.statusCode === 400, "frame scope without page scope should be rejected");

    nock("https://api.figma.com")
      .get("/v1/files/CtxAbCdEf1234")
      .reply(200, buildFigmaFilePayload());
    const guardedRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: project2.id,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/fg-context-guard.json",
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(guardedRunRes.statusCode === 201, "guarded run create should return 201");
    const guardedRun = JSON.parse(guardedRunRes.body.toString("utf8"));
    const parsedGuardedRun = parsePublicIdFor(KINDS.run, guardedRun.run_id);
    assert(parsedGuardedRun.ok, "guarded run id should be public");
    createdRunIds.push(parsedGuardedRun.internalId);

    const guardedRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${guardedRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(guardedRunDetailRes.statusCode === 200, "guarded run detail should return 200");
    const guardedRunDetail = JSON.parse(guardedRunDetailRes.body.toString("utf8"));
    const guardedFigmaCtx = guardedRunDetail.inputs?.connection_context?.figma;
    assert(guardedFigmaCtx.write_guard.requires_confirmation === true, "missing frame target should require confirmation");
    assert(
      guardedFigmaCtx.write_guard.reason === "writable_scope_frame_requires_frame_target",
      "write guard reason should describe frame target requirement"
    );
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
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
    if (prevFigmaToken === undefined) delete process.env.FG_CTX_TOKEN;
    else process.env.FG_CTX_TOKEN = prevFigmaToken;
  }
}

module.exports = { run };
