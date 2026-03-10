const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  delete process.env.OPENAI_API_KEY;

  const userId = `u-${crypto.randomUUID()}`;
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const invalidCreateRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5-mini",
        secret_ref: "sk-proj-plain-secret-should-not-save",
      }),
    });
    assert(invalidCreateRes.statusCode === 400, `raw openai key should be rejected, got ${invalidCreateRes.statusCode}`);

    process.env.OPENAI_API_KEY = "sk-test-openai";
    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5-mini",
        secret_id: "env://OPENAI_API_KEY",
        enabled: true,
        is_default: true,
      }),
    });
    assert(createRes.statusCode === 201, `create should return 201, got ${createRes.statusCode}`);
    const created = JSON.parse(createRes.body.toString("utf8"));
    assert(created.secret_ref === "env://OPENAI_API_KEY", "secret_ref should round-trip");
    assert(created.secret_id === "env://OPENAI_API_KEY", "secret_id alias should round-trip");

    nock("https://api.openai.com")
      .get("/v1/models/gpt-5-mini")
      .matchHeader("authorization", "Bearer sk-test-openai")
      .reply(200, { id: "gpt-5-mini", object: "model" });

    const verifyRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/me/ai-settings/${created.ai_setting_id}/verify`,
      headers: authz,
      body: JSON.stringify({}),
    });
    assert(verifyRes.statusCode === 200, `verify should return 200, got ${verifyRes.statusCode}`);
    const verifyBody = JSON.parse(verifyRes.body.toString("utf8"));
    assert(verifyBody.provider === "openai", "verify provider should be openai");
    assert(verifyBody.model === "gpt-5-mini", "verify model should match");
    assert(verifyBody.status === "ok", "verify status should be ok");
    assert(verifyBody.error === null, "verify error should be null on success");
    assert(verifyBody.evidence_refs && verifyBody.evidence_refs.run_id === "", "verify should return default evidence refs");
    nock.cleanAll();

    const patchRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/me/ai-settings/${created.ai_setting_id}`,
      headers: authz,
      body: JSON.stringify({ secret_ref: "vault://openai/default" }),
    });
    assert(patchRes.statusCode === 200, `patch should return 200, got ${patchRes.statusCode}`);

    const verifyVaultRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/me/ai-settings/${created.ai_setting_id}/verify`,
      headers: authz,
      body: JSON.stringify({}),
    });
    assert(verifyVaultRes.statusCode === 200, `vault verify should return 200, got ${verifyVaultRes.statusCode}`);
    const verifyVaultBody = JSON.parse(verifyVaultRes.body.toString("utf8"));
    assert(verifyVaultBody.status === "error", "vault verify should return error status");
    assert(String(verifyVaultBody.error || "").includes("vault"), "vault verify should explain resolver limitation");
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiApiKey;
  }
}

module.exports = { run };
