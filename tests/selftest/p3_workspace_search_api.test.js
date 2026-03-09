const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun, appendRunExternalOperation } = require("../../src/api/runs");
const { createThread, postMessage } = require("../../src/server/threadsStore");
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
  const createdThreadIds = [];
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
      body: JSON.stringify({ name: "workspace-search", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "Search Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const runId = createRun(db, {
      project_id: parsedProject.internalId,
      thread_id: parsedThread.internalId,
      job_type: "integration_hub.phase1.code_to_figma_from_url",
      run_mode: "mcp",
      target_path: ".ai-runs/{{run_id}}/workspace_search.json",
      inputs: {
        page_url: "https://example.com/search",
      },
    });
    createdRunIds.push(runId);

    postMessage(db, thread.thread_id, {
      role: "user",
      content: "Searchable public note with env://SECRET_SHOULD_NOT_LEAK and confirm_token=abc123",
      run_id: runId,
    }, "user");

    appendRunExternalOperation(db, runId, {
      provider: "github",
      operation_type: "github.write_plan",
      target: { repository: "octocat/hello-world", branch: "feature/search", path: "src/index.js" },
      result: { status: "skipped", failure_code: null, reason: "confirm_required token=ghp_secret_should_not_leak" },
      artifacts: { paths: ["src/index.js"] },
    });

    const defaultRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/workspace/search?project_id=${encodeURIComponent(project.id)}&query=${encodeURIComponent("search")}&limit=5`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(defaultRes.statusCode === 200, `default search should return 200, got ${defaultRes.statusCode}`);
    const defaultBody = JSON.parse(defaultRes.body.toString("utf8"));
    assert(Array.isArray(defaultBody.scopes), "default scopes should be returned");
    assert(defaultBody.scopes.includes("run"), "default scopes should include run");
    assert(!defaultBody.scopes.includes("message"), "default scopes should exclude message");
    assert(Array.isArray(defaultBody.items), "search items should be returned");
    assert(defaultBody.items.some((item) => item.entity === "project"), "project should be searchable");
    assert(defaultBody.items.some((item) => item.entity === "thread"), "thread should be searchable");
    assert(defaultBody.items.some((item) => item.entity === "run"), "run should be searchable");
    assert(defaultBody.items.some((item) => item.entity === "external_operation"), "external_operation should be searchable");

    const providerRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/workspace/search?project_id=${encodeURIComponent(project.id)}&provider_filter=github&scope=run&scope=external_operation`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(providerRes.statusCode === 200, "provider filter search should return 200");
    const providerBody = JSON.parse(providerRes.body.toString("utf8"));
    assert(Array.isArray(providerBody.provider_filter), "provider filter should echo");
    assert(providerBody.provider_filter.includes("github"), "provider filter should include github");
    assert(providerBody.items.some((item) => item.entity === "external_operation"), "provider filter should still return github operation");

    const messageRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/workspace/search",
      headers: authz,
      body: JSON.stringify({
        query: "public note",
        scope: ["message"],
        project_id: project.id,
        thread_id: thread.thread_id,
        limit: 10,
        status_filter: "user",
      }),
    });
    assert(messageRes.statusCode === 200, `message search should return 200, got ${messageRes.statusCode}`);
    const messageBody = JSON.parse(messageRes.body.toString("utf8"));
    assert(messageBody.items.length >= 1, "message search should return message");
    assert(messageBody.items[0].entity === "message", "scope=message should return message items");
    assert(!JSON.stringify(messageBody).includes("env://SECRET_SHOULD_NOT_LEAK"), "secret-like refs must be redacted");
    assert(!JSON.stringify(messageBody).includes("confirm_token=abc123"), "confirm_token must be redacted");
    assert(!JSON.stringify(messageBody).includes("ghp_secret_should_not_leak"), "secret-like token must be redacted");

    const invalidScopeRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/workspace/search?scope=invalid_scope",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidScopeRes.statusCode === 400, "invalid scope should return 400");
    const invalidScopeBody = JSON.parse(invalidScopeRes.body.toString("utf8"));
    assert(invalidScopeBody.details && invalidScopeBody.details.code === "VALIDATION_ERROR", "invalid scope should be validation error");

    const invalidCursorRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/workspace/search?cursor=not_base64",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidCursorRes.statusCode === 400, "invalid cursor should return 400");

    const invalidProviderRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/workspace/search?provider_filter=slack",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidProviderRes.statusCode === 400, "invalid provider filter should return 400");

    const pagedRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/workspace/search?project_id=${encodeURIComponent(project.id)}&limit=1`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(pagedRes.statusCode === 200, "paged search should return 200");
    const pagedBody = JSON.parse(pagedRes.body.toString("utf8"));
    assert(pagedBody.items.length === 1, "limit should be applied");
    if (pagedBody.next_cursor) {
      const nextRes = await requestLocal(handler, {
        method: "GET",
        url: `/api/workspace/search?project_id=${encodeURIComponent(project.id)}&limit=1&cursor=${encodeURIComponent(pagedBody.next_cursor)}`,
        headers: { Authorization: `Bearer ${jwtToken}` },
      });
      assert(nextRes.statusCode === 200, "next page should return 200");
    }
  } finally {
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
