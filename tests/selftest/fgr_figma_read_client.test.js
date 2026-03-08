const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

function buildFigmaFilePayload() {
  return {
    name: "Sample Design",
    lastModified: "2026-03-08T00:00:00Z",
    version: "123",
    editorType: "figma",
    thumbnailUrl: "https://example.com/thumb.png",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
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
              primaryAxisAlignItems: "SPACE_BETWEEN",
              counterAxisAlignItems: "CENTER",
              itemSpacing: 16,
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 20,
              paddingBottom: 20,
              absoluteBoundingBox: { width: 1200, height: 400 },
              children: [
                {
                  id: "10:2",
                  type: "TEXT",
                  name: "Title",
                  characters: "Welcome",
                  absoluteBoundingBox: { width: 200, height: 40 },
                },
                {
                  id: "10:3",
                  type: "INSTANCE",
                  name: "Button / Primary",
                  componentId: "50:1",
                  componentKey: "button-key",
                  variantProperties: { size: "lg" },
                  absoluteBoundingBox: { width: 120, height: 44 },
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
  const prevFigmaToken = process.env.FG_READ_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.FG_READ_TOKEN = "figma_dummy_token";

  const createdProjectIds = [];
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

    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "fg-read-test", staging_url: "https://example.com" }),
    });
    assert(createRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public id");
    createdProjectIds.push(parsedProject.internalId);

    const putSettings = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        figma_file_key: "AbCdEf123456",
        figma_secret_id: "env://FG_READ_TOKEN",
        figma_page_scope: "page:Landing",
        figma_frame_scope: "frame:Hero",
        figma_writable_scope: "frame",
      }),
    });
    assert(putSettings.statusCode === 200, "project settings put should return 200");

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(200, buildFigmaFilePayload());
    const readBase = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(readBase.statusCode === 200, "figma read base should return 200");
    const readBaseBody = JSON.parse(readBase.body.toString("utf8"));
    assert(readBaseBody.file.name === "Sample Design", "file metadata should be returned");
    assert(readBaseBody.target_selection.source.page === "project_default", "default read should use project page scope");
    assert(readBaseBody.target_selection.source.frame === "project_default", "default read should use project frame scope");
    assert(readBaseBody.target_selection.writable_scope === "frame", "writable scope should be projected");
    assert(Array.isArray(readBaseBody.pages) && readBaseBody.pages.length === 1, "pages should be returned");
    assert(Array.isArray(readBaseBody.frames) && readBaseBody.frames.length >= 1, "frames should be returned");
    assert(readBaseBody.frames.some((frame) => frame.id === "10:1"), "target frame should be present");
    assert(readBaseBody.summary.text_node_count >= 1, "text summary should be returned");
    assert(readBaseBody.summary.instance_node_count >= 1, "component summary should include instance");
    assert(readBaseBody.summary.auto_layout_node_count >= 1, "auto layout summary should be returned");

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(200, buildFigmaFilePayload());
    const scopedRead = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        page_name: "Landing",
        frame_name: "Hero",
        node_ids: ["10:2", "10:3"],
      }),
    });
    assert(scopedRead.statusCode === 200, "scoped read should return 200");
    const scopedBody = JSON.parse(scopedRead.body.toString("utf8"));
    assert(scopedBody.target_resolution.page.id === "1:1", "page resolution should be precise");
    assert(scopedBody.target_resolution.frame.id === "10:1", "frame resolution should be precise");
    assert(scopedBody.target_resolution.node_ids.length === 2, "node ids should be resolved");
    assert(scopedBody.nodes.find((node) => node.id === "10:2").text === "Welcome", "text content should be resolved");
    assert(
      scopedBody.nodes.find((node) => node.id === "10:1") === undefined,
      "node lookup should only return requested node_ids when specified"
    );

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(403, { err: "Forbidden" });
    const forbidden = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(forbidden.statusCode === 403, "figma forbidden should return 403");
    const forbiddenBody = JSON.parse(forbidden.body.toString("utf8"));
    assert(forbiddenBody.details.code === "INTEGRATION_ERROR", "forbidden should map to integration_error");
    assert(forbiddenBody.details.reason === "permission_denied", "forbidden reason should match");

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(404, { err: "Not found" });
    const notFound = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(notFound.statusCode === 404, "figma not found should return 404");
    const notFoundBody = JSON.parse(notFound.body.toString("utf8"));
    assert(notFoundBody.details.code === "INTEGRATION_ERROR", "not found should map to integration_error");
    assert(notFoundBody.details.reason === "not_found", "not found reason should match");

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(200, buildFigmaFilePayload());
    const badFrame = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id, page_name: "Landing", frame_name: "MissingFrame" }),
    });
    assert(badFrame.statusCode === 400, "missing frame should return 400");
    const badFrameBody = JSON.parse(badFrame.body.toString("utf8"));
    assert(badFrameBody.details.code === "VALIDATION_ERROR", "missing frame should be validation_error");

    const ambiguousPage = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        page_id: "1:1",
        page_name: "Landing",
      }),
    });
    assert(ambiguousPage.statusCode === 400, "ambiguous page selector should return 400");

    nock("https://api.figma.com")
      .get("/v1/files/AbCdEf123456")
      .reply(200, buildFigmaFilePayload());
    const frameNameWithoutPage = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        frame_name: "Hero",
      }),
    });
    assert(frameNameWithoutPage.statusCode === 200, "frame_name without page should resolve via project page scope");
    const frameNameWithoutPageBody = JSON.parse(frameNameWithoutPage.body.toString("utf8"));
    assert(
      frameNameWithoutPageBody.target_selection.source.page === "project_default",
      "frame_name read should use project default page scope"
    );

    const ambiguousNodeSelector = await requestLocal(handler, {
      method: "POST",
      url: "/api/figma/read",
      headers: authz,
      body: JSON.stringify({
        project_id: project.id,
        node_id: "10:2",
        node_ids: ["10:3"],
      }),
    });
    assert(ambiguousNodeSelector.statusCode === 400, "ambiguous node selector should return 400");
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevFigmaToken === undefined) delete process.env.FG_READ_TOKEN;
    else process.env.FG_READ_TOKEN = prevFigmaToken;
  }
}

module.exports = { run };
