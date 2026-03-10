const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  const actorId = `acct-${crypto.randomUUID()}`;

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: actorId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/admin/knowledge-sources",
      headers,
    });
    assert(listRes.statusCode === 200, `knowledge source list should return 200, got ${listRes.statusCode}`);
    const listBody = JSON.parse(listRes.body.toString("utf8"));
    assert(Array.isArray(listBody.sources) && listBody.sources.length > 0, "knowledge source list should include registry");
    const target = listBody.sources.find((entry) => String(entry.path || "").includes("workflow.md"));
    assert(target, "knowledge source list should include workflow");

    const updateRes = await requestLocal(handler, {
      method: "PUT",
      url: "/api/admin/knowledge-sources",
      headers,
      body: JSON.stringify({
        source_path: target.path,
        enabled: false,
        priority: 7,
        audiences: ["operator"],
        public_scope: "operator_only",
      }),
    });
    assert(updateRes.statusCode === 200, `knowledge source update should return 200, got ${updateRes.statusCode}`);
    const updateBody = JSON.parse(updateRes.body.toString("utf8"));
    assert(updateBody.enabled === false, "knowledge source update should persist enabled");
    assert(updateBody.priority === 7, "knowledge source update should persist priority");
    assert(updateBody.public_scope === "operator_only", "knowledge source update should persist public_scope");

    const policyRow = db
      .prepare("SELECT enabled, priority, public_scope FROM faq_knowledge_source_policies WHERE tenant_id=? AND source_path=?")
      .get(DEFAULT_TENANT, target.path);
    assert(policyRow && Number(policyRow.enabled) === 0, "knowledge source policy should be stored in db");
  } finally {
    db.prepare("DELETE FROM faq_knowledge_source_policies WHERE tenant_id=?").run(DEFAULT_TENANT);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
