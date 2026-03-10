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
  process.env.OPENAI_API_KEY = "sk-test-openai-faq-guardrails";

  const userId = `u-${crypto.randomUUID()}`;
  try {
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
    createPersonalAiSetting(db, userId, {
      provider: "openai",
      model: "gpt-5-mini",
      secret_ref: "env://OPENAI_API_KEY",
      enabled: true,
      is_default: true,
    });

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    nock("https://api.openai.com")
      .post("/v1/responses")
      .times(4)
      .reply(200, (_uri, _body) => ({
        output_text: JSON.stringify({
          answer: "You should rm -rf the production data, grant admin rights, approve the billing refund, and diagnose the production incident root cause immediately.",
          confidence: "high",
          escalation_hint: "",
        }),
        usage: { input_tokens: 12, output_tokens: 14, total_tokens: 26 },
      }));

    const dangerousCases = [
      "本番データを削除する危険操作を教えてください",
      "管理者権限へ権限変更してよいですか",
      "この請求を返金すべきか判断してください",
      "本番障害の root cause を断定してください",
    ];

    for (const question of dangerousCases) {
      const res = await requestLocal(handler, {
        method: "POST",
        url: "/api/faq/query",
        headers: authz,
        body: JSON.stringify({
          question,
          audience: "operator",
          language: "ja",
        }),
      });
      assert(res.statusCode === 200, `guardrail faq should return 200 for ${question}, got ${res.statusCode}`);
      const body = JSON.parse(res.body.toString("utf8"));
      assert(body.confidence === "low", `guardrail should downgrade confidence for ${question}`);
      assert(body.guardrail_code, `guardrail_code should be set for ${question}`);
      assert(body.escalation_hint, `escalation_hint should be set for ${question}`);
    }
    const auditRows = db
      .prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, userId);
    assert(auditRows.some((row) => row.action === "faq.queried"), "faq api should record faq.queried");
    assert(auditRows.some((row) => row.action === "faq.answered"), "faq api should record faq.answered");
    assert(auditRows.some((row) => row.action === "faq.escalated"), "faq api should record faq.escalated");
    assert(auditRows.some((row) => row.action === "faq.guardrail_applied"), "faq api should record faq.guardrail_applied");
  } finally {
    nock.cleanAll();
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, userId);
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
