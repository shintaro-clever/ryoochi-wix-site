function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const SECRET_PATTERNS = [
  /(env|vault):\/\/[^\s"'`]+/gi,
  /\b(ghp|gho|ghu|ghs|ghr|github_pat|sk|figd|figma)_[A-Za-z0-9_-]+\b/gi,
  /\bconfirm_token\s*=\s*[^\s,;]+/gi,
  /\bconfirm_token_hash\s*=\s*[^\s,;]+/gi,
  /\bsecret_id\s*=\s*[^\s,;]+/gi,
  /\b(token|password|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

function sanitizeSecretLikeText(value, { fallbackRedact = true } = {}) {
  let text = normalizeText(value);
  if (!text) return "";
  const original = text;
  SECRET_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, "[redacted]");
  });
  if (text !== original) {
    return text || "[redacted]";
  }
  if (fallbackRedact && /token|secret|password|api[_-]?key|confirm_token|confirm_token_hash/i.test(text)) {
    return "[redacted]";
  }
  return text;
}

function isRawAuditLikeText(text) {
  const value = normalizeText(text);
  if (!value) return false;
  if (/audit\.jsonl|meta_json|AUDIT_WRITE_FAILED|RUN_STATUS_CHANGED|LOGIN_SUCCESS/i.test(value)) {
    return true;
  }
  if (/"type"\s*:\s*"[^"]+"/.test(value) && /"actor"\s*:\s*\{/.test(value) && /"meta"\s*:\s*\{/.test(value)) {
    return true;
  }
  return false;
}

function sanitizePiiText(value) {
  let text = normalizeText(value);
  if (!text) return "";
  let piiHits = 0;
  text = text.replace(EMAIL_PATTERN, () => {
    piiHits += 1;
    return "[redacted_pii]";
  });
  text = text.replace(PHONE_PATTERN, () => {
    piiHits += 1;
    return "[redacted_pii]";
  });
  text = text.replace(SSN_PATTERN, () => {
    piiHits += 1;
    return "[redacted_pii]";
  });
  if (piiHits >= 3) {
    return "[redacted_pii]";
  }
  return text;
}

function sanitizeOpenAiText(value, { maxLength = 6000 } = {}) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (isRawAuditLikeText(raw)) {
    return "[redacted_audit]";
  }
  const secretSafe = sanitizeSecretLikeText(raw, { fallbackRedact: true });
  const piiSafe = sanitizePiiText(secretSafe);
  if (!piiSafe) return "";
  if (piiSafe.length > maxLength) {
    return `${piiSafe.slice(0, maxLength)}...[truncated]`;
  }
  return piiSafe;
}

function buildOpenAiBoundaryPayload({ prompt = "", evidence_summary = "" } = {}) {
  return {
    prompt: sanitizeOpenAiText(prompt),
    evidence_summary: sanitizeOpenAiText(evidence_summary),
  };
}

module.exports = {
  sanitizeSecretLikeText,
  sanitizeOpenAiText,
  buildOpenAiBoundaryPayload,
};
