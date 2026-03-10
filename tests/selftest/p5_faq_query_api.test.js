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
  process.env.OPENAI_API_KEY = "sk-test-openai-faq";

  const userId = `u-${crypto.randomUUID()}`;
  try {
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

    let openAiCallIndex = 0;
    nock("https://api.openai.com")
      .post("/v1/responses")
      .times(3)
      .reply(200, () => {
        openAiCallIndex += 1;
        if (openAiCallIndex === 1) {
          return {
            output_text: JSON.stringify({
              answer: "Phase5 limits OpenAI to summary, analysis, proposal, translation, and FAQ answers.",
              confidence: "high",
              escalation_hint: "",
            }),
            usage: { input_tokens: 12, output_tokens: 11, total_tokens: 23 },
          };
        }
        if (openAiCallIndex === 2) {
          return {
            output_text: JSON.stringify({
              answer: "Check the VPS external operations checklist after deployment.",
              confidence: "medium",
              escalation_hint: "If deployment context differs, confirm the runbook manually.",
            }),
            usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
          };
        }
        return {
          output_text: JSON.stringify({
            faq: {
              answer: "Review the VPS external operations checklist after deployment.",
              escalation_hint: "If context differs, confirm the runbook manually.",
              follow_up_actions: [],
            },
          }),
          usage: { input_tokens: 8, output_tokens: 10, total_tokens: 18 },
        };
      });

    const generalRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/faq/query",
      headers: authz,
      body: JSON.stringify({
        question: "Phase5 で OpenAI は何に使いますか",
        audience: "general",
        language: "ja",
      }),
    });
    assert(generalRes.statusCode === 200, `general faq should return 200, got ${generalRes.statusCode}`);
    const generalBody = JSON.parse(generalRes.body.toString("utf8"));
    assert(generalBody.use_case === "faq", "faq response should include use_case");
    assert(generalBody.confidence === "high", "general faq should preserve confidence");
    assert(Array.isArray(generalBody.evidence_refs.doc_source), "general faq should include doc_source evidence");
    assert(
      generalBody.evidence_refs.doc_source.some((entry) => String(entry.path || "").includes("workflow.md")),
      "general faq should cite workflow source"
    );

    const escalationRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/faq/query",
      headers: authz,
      body: JSON.stringify({
        question: "このFAQに存在しない未定義の秘密運用を教えてください",
        audience: "operator",
        language: "ja",
      }),
    });
    assert(escalationRes.statusCode === 200, `unknown faq should return 200, got ${escalationRes.statusCode}`);
    const escalationBody = JSON.parse(escalationRes.body.toString("utf8"));
    assert(escalationBody.confidence === "low", "unknown faq should downgrade confidence");
    assert(escalationBody.escalation_hint, "unknown faq should include escalation_hint");

    const operatorEnRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/faq/query",
      headers: authz,
      body: JSON.stringify({
        question: "What should I check after VPS deploy?",
        audience: "operator",
        language: "en",
      }),
    });
    assert(operatorEnRes.statusCode === 200, `operator faq should return 200, got ${operatorEnRes.statusCode}`);
    const operatorEnBody = JSON.parse(operatorEnRes.body.toString("utf8"));
    assert(operatorEnBody.answer.includes("checklist"), "operator english faq should be translated");
    assert(operatorEnBody.escalation_hint.includes("runbook"), "operator english faq should preserve escalation hint");
    assert(Array.isArray(operatorEnBody.evidence_refs.runbook), "operator faq should include runbook evidence");
    assert(
      operatorEnBody.evidence_refs.runbook.some((entry) => String(entry.path || "").includes("vps-external-operations-checklist.md")),
      "operator faq should cite runbook evidence"
    );
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
