const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createThread } = require("../../src/server/threadsStore");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

function insertAudit(action, meta, createdAt) {
  db.prepare("INSERT INTO audit_logs(tenant_id, actor_id, action, meta_json, created_at) VALUES(?,?,?,?,?)").run(
    DEFAULT_TENANT,
    "metrics-user",
    action,
    JSON.stringify(meta),
    createdAt
  );
}

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
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
    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "ai-usage-metrics", staging_url: "https://example.com" }),
    });
    assert(projectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(projectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    createdProjectIds.push(parsedProject.internalId);

    const thread = createThread(db, parsedProject.internalId, "AI Usage Metrics Thread");
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    createdThreadIds.push(parsedThread.internalId);

    const base = Date.parse("2026-03-10T10:00:00.000Z");
    insertAudit("openai.assist.call", {
      provider: "openai",
      use_case: "run_summary",
      model: "gpt-4.1-mini",
      project_id: project.id,
      thread_id: thread.thread_id,
      run_id: "run_metrics_1",
      status: "ok",
      failure_code: null,
      latency_ms: 120,
      token_usage: { input_tokens: 12, output_tokens: 18, total_tokens: 30 },
    }, new Date(base).toISOString());
    insertAudit("openai.assist.call", {
      provider: "openai",
      use_case: "translation",
      model: "gpt-4.1-mini",
      project_id: project.id,
      thread_id: thread.thread_id,
      status: "error",
      failure_code: "rate_limit",
      latency_ms: 210,
      token_usage: { input_tokens: 15, output_tokens: 0, total_tokens: 15 },
    }, new Date(base + 1000).toISOString());
    insertAudit("ai.summary.request", {
      summary_type: "history",
      project_id: project.id,
      thread_id: thread.thread_id,
      status: "ok",
      failure_code: null,
    }, new Date(base + 2000).toISOString());
    insertAudit("ai.analysis.request", {
      analysis_type: "observability",
      alert_code: "failed_ratio_surge",
      project_id: project.id,
      thread_id: thread.thread_id,
      status: "ok",
      failure_code: null,
    }, new Date(base + 3000).toISOString());
    insertAudit("ai.translation.request", {
      source_use_case: "faq",
      target_language: "en",
      project_id: project.id,
      thread_id: thread.thread_id,
      status: "ok",
      failure_code: null,
    }, new Date(base + 4000).toISOString());
    insertAudit("faq.query", {
      audience: "general",
      language: "en",
      status: "ok",
      confidence: "medium",
      escalation: false,
      resolved: true,
      guardrail_triggered: false,
      guardrail_code: null,
      failure_code: null,
      token_usage: { input_tokens: 10, output_tokens: 11, total_tokens: 21 },
    }, new Date(base + 5000).toISOString());
    insertAudit("faq.query", {
      audience: "operator",
      language: "ja",
      status: "ok",
      confidence: "low",
      escalation: true,
      resolved: false,
      guardrail_triggered: true,
      guardrail_code: "permission_change",
      failure_code: null,
      token_usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
    }, new Date(base + 6000).toISOString());

    const metricsRes = await requestLocal(handler, {
      method: "GET",
      url:
        `/api/metrics/workspace?project_id=${encodeURIComponent(project.id)}` +
        `&thread_id=${encodeURIComponent(thread.thread_id)}` +
        `&start_at=${encodeURIComponent(new Date(base - 1000).toISOString())}` +
        `&end_at=${encodeURIComponent(new Date(base + 7000).toISOString())}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(metricsRes.statusCode === 200, `metrics should return 200, got ${metricsRes.statusCode}`);
    const body = JSON.parse(metricsRes.body.toString("utf8"));

    assert(body.ai_requests.total === 2, "ai_requests total should include wrapper calls");
    assert(body.ai_failures.total === 1, "ai_failures total should count failed wrapper calls");
    assert(body.ai_latency.median_ms === 120, "ai latency median should be aggregated");
    assert(body.ai_token_usage.total_tokens === 45, "ai token usage should be aggregated");
    assert(body.summary_requests.total === 1, "summary request count should be aggregated");
    assert(body.analysis_requests.total === 1, "analysis request count should be aggregated");
    assert(body.translation_requests.total === 1, "translation request count should be aggregated");
    assert(body.faq_queries.total === 2, "faq query count should be aggregated");
    assert(body.faq_queries.guardrail_triggered === 1, "faq guardrail count should be aggregated");
    assert(body.faq_queries.escalation_rate_pct === 50, "faq escalation rate should be aggregated");
    assert(body.faq_resolution_rate.total.rate_pct === 50, "faq resolution rate should be aggregated");
    assert(body.faq_queries.by_audience.some((entry) => entry.audience === "general" && entry.count === 1), "faq audience general should be counted");
    assert(body.faq_queries.by_audience.some((entry) => entry.audience === "operator" && entry.count === 1), "faq audience operator should be counted");
    assert(body.language_distribution.total.some((entry) => entry.language === "en" && entry.count === 2), "language distribution should include en");
    assert(body.language_distribution.total.some((entry) => entry.language === "ja" && entry.count === 1), "language distribution should include ja");
    assert(body.analysis_requests.by_alert_code.some((entry) => entry.alert_code === "failed_ratio_surge" && entry.count === 1), "analysis alert code should be counted");
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    db.prepare("DELETE FROM audit_logs WHERE tenant_id=? AND actor_id=?").run(DEFAULT_TENANT, "metrics-user");
    process.env.AUTH_MODE = prevAuthMode;
    process.env.JWT_SECRET = prevJwt;
    process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
