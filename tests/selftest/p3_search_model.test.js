const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const workflowPath = path.join(process.cwd(), "docs", "ai", "core", "workflow.md");
  const searchModelPath = path.join(process.cwd(), "docs", "ai", "core", "search-model.md");
  const readmePath = path.join(process.cwd(), "README.md");

  assert(fs.existsSync(workflowPath), "workflow should exist");
  assert(fs.existsSync(searchModelPath), "search model doc should exist");
  assert(fs.existsSync(readmePath), "README should exist");

  const workflow = fs.readFileSync(workflowPath, "utf8");
  const searchModel = fs.readFileSync(searchModelPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(workflow.includes("docs/ai/core/search-model.md"), "workflow should link search model");
  assert(searchModel.includes("project"), "search model should include project");
  assert(searchModel.includes("thread"), "search model should include thread");
  assert(searchModel.includes("run"), "search model should include run");
  assert(searchModel.includes("message"), "search model should include message");
  assert(searchModel.includes("external_operation"), "search model should include external_operation");
  assert(searchModel.includes("external_audit"), "search model should include external_audit");
  assert(searchModel.includes("confirm_token"), "search model should exclude confirm_token");
  assert(searchModel.includes("secret_id"), "search model should exclude secret_id resolved values");
  assert(searchModel.includes("hidden/private"), "search model should exclude hidden/private body");
  assert(readme.includes("search-model.md"), "README should link search model");

  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
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
    const res = await requestLocal(handler, {
      method: "GET",
      url: "/api/search/model",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(res.statusCode === 200, `search model api should return 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body.toString("utf8"));
    assert(body.version, "search model api should include version");
    assert(Array.isArray(body.entities), "search model api should include entities");
    assert(body.entities.some((entry) => entry.entity === "external_audit"), "search model api should include external_audit");
    assert(
      body.entities.some(
        (entry) =>
          entry.entity === "external_operation" &&
          Array.isArray(entry.non_searchable_fields) &&
          entry.non_searchable_fields.includes("confirm_token")
      ),
      "search model api should exclude confirm_token"
    );
  } finally {
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
