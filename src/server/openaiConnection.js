const { verifyOpenAiModelConnection } = require("../ai/openaiClient");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveSecretReference(secretRef, { fallbackEnvName = "" } = {}) {
  const ref = normalizeText(secretRef);
  if (!ref) {
    const fallbackName = normalizeText(fallbackEnvName);
    if (fallbackName) {
      const fallbackValue = normalizeText(process.env[fallbackName]);
      if (fallbackValue) {
        return { ok: true, value: fallbackValue, source: `env://${fallbackName}` };
      }
    }
    return { ok: false, error: "secret_ref is not configured" };
  }
  if (ref.startsWith("env://")) {
    const envName = normalizeText(ref.slice("env://".length));
    if (!envName) {
      return { ok: false, error: "secret_ref env target is empty" };
    }
    const envValue = normalizeText(process.env[envName]);
    if (!envValue) {
      return { ok: false, error: `secret_ref env target is missing: ${envName}` };
    }
    return { ok: true, value: envValue, source: `env://${envName}` };
  }
  if (ref.startsWith("vault://")) {
    return { ok: false, error: "vault secret_ref verification is not available in this environment" };
  }
  return { ok: false, error: "secret_ref must use env:// or vault:// format" };
}

async function verifyOpenAiConnection({ model, apiKey, evidence_refs = null, timeoutMs = 10000 } = {}) {
  return verifyOpenAiModelConnection({
    model: normalizeText(model),
    apiKey: normalizeText(apiKey),
    evidence_refs,
    timeout_ms: timeoutMs,
  });
}

module.exports = {
  resolveSecretReference,
  verifyOpenAiConnection,
};
