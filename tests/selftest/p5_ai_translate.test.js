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
  process.env.OPENAI_API_KEY = "sk-test-openai-translate";

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

    let callIndex = 0;
    nock("https://api.openai.com")
      .post("/v1/responses")
      .times(3)
      .reply(200, (_uri, reqBody) => {
        callIndex += 1;
        if (callIndex === 1) {
          return {
            output_text: JSON.stringify({
              summary: {
                overview: "English overview while keeping status literal.",
                main_failure_reasons: ["status remained failed", "failure_code stayed validation_error"],
                priority_actions: ["Check run evidence_refs before retry"],
              },
            }),
            usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
          };
        }
        if (callIndex === 2) {
          return {
            output_text: JSON.stringify({
              analysis: {
                candidate_causes: ["reason_type remained stable while prose changed"],
                impact_scope: ["project and thread communication improved"],
                additional_checks: ["Confirm evidence_refs before operator action"],
              },
            }),
            usage: { input_tokens: 12, output_tokens: 12, total_tokens: 24 },
          };
        }
        return {
          output_text: JSON.stringify({
            faq: {
              answer: "English FAQ answer while keeping confirm_required and evidence_refs literal.",
              follow_up_actions: ["Review status and failure_code before continuing"],
            },
          }),
          usage: { input_tokens: 8, output_tokens: 10, total_tokens: 18 },
        };
      });

    const summaryRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai/translate",
      headers: authz,
      body: JSON.stringify({
        source_use_case: "run_summary",
        target_language: "en",
        payload: {
          summary: {
            overview: "実行概要です。",
            main_failure_reasons: ["status は failed のままです", "failure_code は validation_error です"],
            priority_actions: ["evidence_refs を確認してください"],
          },
        },
        evidence_refs: {
          run_id: "run_12345678-1234-1234-1234-123456789abc",
          thread_id: "thread_12345678-1234-1234-1234-123456789abc",
        },
      }),
    });
    assert(summaryRes.statusCode === 200, `summary translate should return 200, got ${summaryRes.statusCode}`);
    const summaryBody = JSON.parse(summaryRes.body.toString("utf8"));
    assert(summaryBody.source_use_case === "run_summary", "source_use_case should match");
    assert(summaryBody.target_language === "en", "target_language should match");
    assert(summaryBody.translated.summary.overview.includes("English"), "summary should be translated");
    assert(summaryBody.evidence_refs.run_id.startsWith("run_"), "evidence refs should be preserved");

    const analysisRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai/translate",
      headers: authz,
      body: JSON.stringify({
        source_use_case: "observability_analysis",
        target_language: "en",
        payload: {
          analysis: {
            candidate_causes: ["reason_type を維持して説明してください"],
            impact_scope: ["project と thread に影響します"],
            additional_checks: ["evidence_refs を再確認してください"],
          },
        },
        evidence_refs: {
          thread_id: "thread_12345678-1234-1234-1234-123456789abc",
        },
      }),
    });
    assert(analysisRes.statusCode === 200, `analysis translate should return 200, got ${analysisRes.statusCode}`);
    const analysisBody = JSON.parse(analysisRes.body.toString("utf8"));
    assert(Array.isArray(analysisBody.translated.analysis.candidate_causes), "analysis translated shape should match");

    const faqRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ai/translate",
      headers: authz,
      body: JSON.stringify({
        source_use_case: "faq",
        target_language: "en",
        payload: {
          faq: {
            answer: "confirm_required と evidence_refs の説明です。",
            follow_up_actions: ["status を見てください"],
          },
        },
        evidence_refs: {
          doc_source: [{ title: "FAQ Source", path: "docs/faq.md" }],
        },
      }),
    });
    assert(faqRes.statusCode === 200, `faq translate should return 200, got ${faqRes.statusCode}`);
    const faqBody = JSON.parse(faqRes.body.toString("utf8"));
    assert(faqBody.translated.faq.answer.includes("FAQ"), "faq translated answer should exist");
    assert(Array.isArray(faqBody.translated.faq.follow_up_actions), "faq follow_up_actions should be translated");
    const auditRows = db
      .prepare("SELECT action FROM audit_logs WHERE tenant_id=? AND actor_id=? ORDER BY created_at ASC")
      .all(DEFAULT_TENANT, userId);
    assert(auditRows.some((row) => row.action === "translation.generated"), "translate api should record translation.generated");
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
