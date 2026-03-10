const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createPersonalAiSetting } = require("../../src/server/personalAiSettingsStore");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.OPENAI_API_KEY = "sk-test-openai-faq-policy";

  const userId = `u-${crypto.randomUUID()}`;
  try {
    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });
    db.prepare(
      `INSERT INTO faq_knowledge_source_policies(tenant_id,source_path,enabled,priority,audiences_json,public_scope,updated_at)
       VALUES(?,?,?,?,?,?,?)`
    ).run(
      DEFAULT_TENANT,
      "docs/runbooks/vps-external-operations-checklist.md",
      0,
      1,
      JSON.stringify(["operator"]),
      "operator_only",
      new Date().toISOString()
    );

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const token = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    nock("https://api.openai.com").post("/v1/responses").reply(200, {
      output_text: JSON.stringify({
        answer: "fallback",
        confidence: "low",
        escalation_hint: "check docs",
      }),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const res = await requestLocal(handler, {
      method: "POST",
      url: "/api/faq/query",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What should I check after VPS deploy?",
        audience: "operator",
        language: "ja",
      }),
    });
    assert(res.statusCode === 200, `faq query should return 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body.toString("utf8"));
    assert(
      !(body.evidence_refs.runbook || []).some((entry) => String(entry.path || "").includes("vps-external-operations-checklist.md")),
      "disabled knowledge source should not appear in faq evidence"
    );
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM faq_knowledge_source_policies WHERE tenant_id=?").run(DEFAULT_TENANT);
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
