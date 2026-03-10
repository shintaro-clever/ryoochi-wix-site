const https = require("https");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { buildOpenAiBoundaryPayload } = require("./openaiDataBoundary");
const { buildEvidenceRefs, evidenceRefsToSummary, summarizeEvidenceRefs } = require("./aiEvidenceModel");
const { recordAiLifecycleEvent } = require("../server/aiMetricsAudit");

const DEFAULT_TIMEOUT_MS = 20000;
const OPENAI_HOST = "https://api.openai.com";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeText(value, max = 200) {
  const text = normalizeText(value);
  if (!text) {
    return { present: false, length: 0, preview: "" };
  }
  return {
    present: true,
    length: text.length,
    preview: text.slice(0, max),
  };
}

function normalizeUsage(usage) {
  const source = usage && typeof usage === "object" ? usage : {};
  const input = Number(source.input_tokens);
  const output = Number(source.output_tokens);
  const total = Number(source.total_tokens);
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    total_tokens: Number.isFinite(total) ? total : 0,
  };
}

function isConnectionFailure(error) {
  const code = normalizeText(error && error.code).toUpperCase();
  return ["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ECONNABORTED"].includes(code);
}

function normalizeFailureCode({ statusCode = 0, error = null } = {}) {
  if (error && normalizeText(error.message) === "openai_timeout") return "timeout";
  if (error && normalizeText(error && error.code).toUpperCase() === "ETIMEDOUT") return "timeout";
  if (error && isConnectionFailure(error)) return "connection_failed";
  if (statusCode === 401 || statusCode === 403) return "unauthorized";
  if (statusCode === 404) return "not_found";
  if (statusCode === 408) return "timeout";
  if (statusCode === 409) return "conflict";
  if (statusCode === 422 || statusCode === 400) return "invalid_request";
  if (statusCode === 429) return "rate_limit";
  if (statusCode >= 500) return "service_unavailable";
  if (error) return "connection_failed";
  return "unknown_error";
}

function buildErrorMessage({ statusCode = 0, payload = null, error = null } = {}) {
  if (payload && payload.error && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (error && error.message) {
    return String(error.message);
  }
  if (statusCode > 0) {
    return `openai request failed (${statusCode})`;
  }
  return "openai request failed";
}

function requestOpenAiJson({ method = "GET", path, apiKey, body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${OPENAI_HOST}${path}`,
      {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let payload = null;
          try {
            payload = data ? JSON.parse(data) : null;
          } catch {
            payload = null;
          }
          resolve({
            statusCode: typeof res.statusCode === "number" ? res.statusCode : 0,
            payload,
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      const timeoutError = new Error("openai_timeout");
      timeoutError.code = "ETIMEDOUT";
      req.destroy(timeoutError);
    });
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const chunk of content) {
      if (chunk && typeof chunk.text === "string" && chunk.text.trim()) {
        parts.push(chunk.text.trim());
      }
    }
  }
  return parts.join("\n").trim();
}

function recordOpenAiAudit({
  db = null,
  actorId = null,
  tenantId = DEFAULT_TENANT,
  useCase,
  model,
  latencyMs,
  status,
  failureCode,
  prompt,
  evidenceSummary,
  evidenceRefs,
  response,
  tokenUsage,
} = {}) {
  recordAudit({
    db,
    action: AUDIT_ACTIONS.OPENAI_ASSIST_CALL,
    tenantId,
    actorId,
    meta: {
      provider: "openai",
      use_case: normalizeText(useCase),
      model: normalizeText(model),
      run_id: normalizeText(evidenceRefs && evidenceRefs.run_id),
      thread_id: normalizeText(evidenceRefs && evidenceRefs.thread_id),
      project_id: normalizeText(evidenceRefs && evidenceRefs.history_window && evidenceRefs.history_window.project_id),
      status: normalizeText(status),
      failure_code: normalizeText(failureCode) || null,
      latency_ms: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : 0,
      prompt_summary: summarizeText(prompt),
      evidence_summary: summarizeText(evidenceSummary),
      evidence_refs_summary: summarizeEvidenceRefs(evidenceRefs),
      response_summary: summarizeText(response),
      token_usage: normalizeUsage(tokenUsage),
    },
  });
}

async function executeOpenAiTextUseCase({
  db = null,
  actorId = null,
  tenantId = DEFAULT_TENANT,
  apiKey,
  model,
  use_case,
  prompt,
  evidence_summary = "",
  evidence_refs = null,
  timeout_ms = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedApiKey = normalizeText(apiKey);
  const normalizedModel = normalizeText(model);
  const normalizedUseCase = normalizeText(use_case);
  const normalizedEvidenceRefs = buildEvidenceRefs(evidence_refs);
  const evidenceRefsSummary = evidenceRefsToSummary(normalizedEvidenceRefs);
  const boundary = buildOpenAiBoundaryPayload({
    prompt,
    evidence_summary: [normalizeText(evidence_summary), evidenceRefsSummary].filter(Boolean).join("\n\n"),
  });
  const normalizedPrompt = boundary.prompt;
  const normalizedEvidence = boundary.evidence_summary;
  const startedAt = Date.now();
  let result = null;

  if (!normalizedApiKey) {
    result = {
      provider: "openai",
      model: normalizedModel,
      use_case: normalizedUseCase,
      prompt: normalizedPrompt,
      evidence_summary: normalizedEvidence,
      evidence_refs: normalizedEvidenceRefs,
      response: "",
      latency_ms: 0,
      token_usage: normalizeUsage(null),
      failure_code: "unauthorized",
      status: "error",
      error: "api key is unavailable",
    };
    recordOpenAiAudit({
      db,
      actorId,
      tenantId,
      useCase: result.use_case,
      model: result.model,
      latencyMs: result.latency_ms,
      status: result.status,
      failureCode: result.failure_code,
      prompt: result.prompt,
      evidenceSummary: result.evidence_summary,
      evidenceRefs: result.evidence_refs,
      response: result.error,
      tokenUsage: result.token_usage,
    });
    return result;
  }
  if (!normalizedModel) {
    result = {
      provider: "openai",
      model: "",
      use_case: normalizedUseCase,
      prompt: normalizedPrompt,
      evidence_summary: normalizedEvidence,
      evidence_refs: normalizedEvidenceRefs,
      response: "",
      latency_ms: 0,
      token_usage: normalizeUsage(null),
      failure_code: "invalid_request",
      status: "error",
      error: "model is required",
    };
    recordOpenAiAudit({
      db,
      actorId,
      tenantId,
      useCase: result.use_case,
      model: result.model,
      latencyMs: result.latency_ms,
      status: result.status,
      failureCode: result.failure_code,
      prompt: result.prompt,
      evidenceSummary: result.evidence_summary,
      evidenceRefs: result.evidence_refs,
      response: result.error,
      tokenUsage: result.token_usage,
    });
    return result;
  }
  if (!normalizedUseCase) {
    result = {
      provider: "openai",
      model: normalizedModel,
      use_case: "",
      prompt: normalizedPrompt,
      evidence_summary: normalizedEvidence,
      evidence_refs: normalizedEvidenceRefs,
      response: "",
      latency_ms: 0,
      token_usage: normalizeUsage(null),
      failure_code: "invalid_request",
      status: "error",
      error: "use_case is required",
    };
    recordOpenAiAudit({
      db,
      actorId,
      tenantId,
      useCase: result.use_case,
      model: result.model,
      latencyMs: result.latency_ms,
      status: result.status,
      failureCode: result.failure_code,
      prompt: result.prompt,
      evidenceSummary: result.evidence_summary,
      evidenceRefs: result.evidence_refs,
      response: result.error,
      tokenUsage: result.token_usage,
    });
    return result;
  }
  if (!normalizedPrompt) {
    result = {
      provider: "openai",
      model: normalizedModel,
      use_case: normalizedUseCase,
      prompt: "",
      evidence_summary: normalizedEvidence,
      evidence_refs: normalizedEvidenceRefs,
      response: "",
      latency_ms: 0,
      token_usage: normalizeUsage(null),
      failure_code: "invalid_request",
      status: "error",
      error: "prompt is required",
    };
    recordOpenAiAudit({
      db,
      actorId,
      tenantId,
      useCase: result.use_case,
      model: result.model,
      latencyMs: result.latency_ms,
      status: result.status,
      failureCode: result.failure_code,
      prompt: result.prompt,
      evidenceSummary: result.evidence_summary,
      evidenceRefs: result.evidence_refs,
      response: result.error,
      tokenUsage: result.token_usage,
    });
    return result;
  }
  recordAiLifecycleEvent({
    db,
    actorId,
    tenantId,
    action: AUDIT_ACTIONS.AI_REQUESTED,
    useCase: normalizedUseCase,
    model: normalizedModel,
    projectId: normalizeText(normalizedEvidenceRefs && normalizedEvidenceRefs.history_window && normalizedEvidenceRefs.history_window.project_id),
    threadId: normalizeText(normalizedEvidenceRefs && normalizedEvidenceRefs.thread_id),
    runId: normalizeText(normalizedEvidenceRefs && normalizedEvidenceRefs.run_id),
    prompt: normalizedPrompt,
    evidenceSummary: normalizedEvidence,
    evidenceRefs: normalizedEvidenceRefs,
  });
  try {
    const response = await requestOpenAiJson({
      method: "POST",
      path: "/v1/responses",
      apiKey: normalizedApiKey,
      timeoutMs: timeout_ms,
      body: {
        model: normalizedModel,
        input: normalizedEvidence
          ? `Use case: ${normalizedUseCase}\n\nEvidence summary:\n${normalizedEvidence}\n\nPrompt:\n${normalizedPrompt}`
          : `Use case: ${normalizedUseCase}\n\nPrompt:\n${normalizedPrompt}`,
      },
    });
    const latencyMs = Date.now() - startedAt;
    if (response.statusCode >= 200 && response.statusCode < 300) {
      result = {
        provider: "openai",
        model: normalizedModel,
        use_case: normalizedUseCase,
        prompt: normalizedPrompt,
        evidence_summary: normalizedEvidence,
        evidence_refs: normalizedEvidenceRefs,
        response: extractResponseText(response.payload),
        latency_ms: latencyMs,
        token_usage: normalizeUsage(response.payload && response.payload.usage),
        failure_code: null,
        status: "ok",
        error: null,
      };
    } else {
      result = {
        provider: "openai",
        model: normalizedModel,
        use_case: normalizedUseCase,
        prompt: normalizedPrompt,
        evidence_summary: normalizedEvidence,
        evidence_refs: normalizedEvidenceRefs,
        response: "",
        latency_ms: latencyMs,
        token_usage: normalizeUsage(response.payload && response.payload.usage),
        failure_code: normalizeFailureCode({ statusCode: response.statusCode }),
        status: "error",
        error: buildErrorMessage({ statusCode: response.statusCode, payload: response.payload }),
      };
    }
  } catch (error) {
    result = {
      provider: "openai",
      model: normalizedModel,
      use_case: normalizedUseCase,
      prompt: normalizedPrompt,
      evidence_summary: normalizedEvidence,
      evidence_refs: normalizedEvidenceRefs,
      response: "",
      latency_ms: Date.now() - startedAt,
      token_usage: normalizeUsage(null),
      failure_code: normalizeFailureCode({ error }),
      status: "error",
      error: buildErrorMessage({ error }),
    };
  }

  recordAiLifecycleEvent({
    db,
    actorId,
    tenantId,
    action: result.status === "ok" ? AUDIT_ACTIONS.AI_COMPLETED : AUDIT_ACTIONS.AI_FAILED,
    useCase: result.use_case,
    model: result.model,
    projectId: normalizeText(result.evidence_refs && result.evidence_refs.history_window && result.evidence_refs.history_window.project_id),
    threadId: normalizeText(result.evidence_refs && result.evidence_refs.thread_id),
    runId: normalizeText(result.evidence_refs && result.evidence_refs.run_id),
    prompt: result.prompt,
    evidenceSummary: result.evidence_summary,
    evidenceRefs: result.evidence_refs,
    response: result.status === "ok" ? result.response : result.error,
    status: result.status,
    failureCode: result.failure_code,
    latencyMs: result.latency_ms,
    tokenUsage: result.token_usage,
  });

  recordOpenAiAudit({
    db,
    actorId,
    tenantId,
    useCase: result.use_case,
    model: result.model,
    latencyMs: result.latency_ms,
    status: result.status,
    failureCode: result.failure_code,
    prompt: result.prompt,
    evidenceSummary: result.evidence_summary,
    evidenceRefs: result.evidence_refs,
    response: result.response,
    tokenUsage: result.token_usage,
  });
  return result;
}

async function verifyOpenAiModelConnection({
  db = null,
  actorId = null,
  tenantId = DEFAULT_TENANT,
  apiKey,
  model,
  evidence_refs = null,
  timeout_ms = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedApiKey = normalizeText(apiKey);
  const normalizedModel = normalizeText(model);
  const normalizedEvidenceRefs = buildEvidenceRefs(evidence_refs);
  const startedAt = Date.now();
  let result;
  try {
    const response = await requestOpenAiJson({
      method: "GET",
      path: `/v1/models/${encodeURIComponent(normalizedModel)}`,
      apiKey: normalizedApiKey,
      timeoutMs: timeout_ms,
    });
    const latencyMs = Date.now() - startedAt;
    if (response.statusCode >= 200 && response.statusCode < 300) {
      result = {
        provider: "openai",
        model: normalizedModel,
        evidence_refs: normalizedEvidenceRefs,
        status: "ok",
        error: null,
        latency_ms: latencyMs,
        failure_code: null,
        token_usage: normalizeUsage(null),
      };
    } else {
      result = {
        provider: "openai",
        model: normalizedModel,
        evidence_refs: normalizedEvidenceRefs,
        status: "error",
        error: buildErrorMessage({ statusCode: response.statusCode, payload: response.payload }),
        latency_ms: latencyMs,
        failure_code: normalizeFailureCode({ statusCode: response.statusCode }),
        token_usage: normalizeUsage(null),
      };
    }
  } catch (error) {
    result = {
      provider: "openai",
      model: normalizedModel,
      evidence_refs: normalizedEvidenceRefs,
      status: "error",
      error: buildErrorMessage({ error }),
      latency_ms: Date.now() - startedAt,
      failure_code: normalizeFailureCode({ error }),
      token_usage: normalizeUsage(null),
    };
  }
  recordOpenAiAudit({
    db,
    actorId,
    tenantId,
    useCase: "verify",
    model: result.model,
    latencyMs: result.latency_ms,
    status: result.status,
    failureCode: result.failure_code,
    prompt: "",
    evidenceSummary: "",
    evidenceRefs: result.evidence_refs,
    response: result.error || result.status,
    tokenUsage: result.token_usage,
  });
  return result;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  executeOpenAiTextUseCase,
  verifyOpenAiModelConnection,
  normalizeFailureCode,
};
