const { sanitizeOpenAiText } = require("./openaiDataBoundary");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeEvidenceString(value, { maxLength = 500 } = {}) {
  const text = normalizeText(value);
  if (/^(project|thread|run|ai_setting)_[0-9a-f-]{36}$/i.test(text)) {
    return text;
  }
  return sanitizeOpenAiText(value, { maxLength });
}

function isSensitiveEvidenceKey(key) {
  return /token|password|secret|api[_-]?key|confirm_token|confirm_token_hash/i.test(normalizeText(key));
}

function sanitizeEvidenceValue(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeEvidenceString(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 20)
      .map((entry) => sanitizeEvidenceValue(entry, depth + 1))
      .filter((entry) => entry !== null && entry !== "");
    return items.length ? items : null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) continue;
    const sanitizedEntry = isSensitiveEvidenceKey(normalizedKey)
      ? "[redacted]"
      : sanitizeEvidenceValue(entry, depth + 1);
    if (sanitizedEntry === null || sanitizedEntry === "") continue;
    output[normalizedKey] = sanitizedEntry;
  }
  return Object.keys(output).length ? output : null;
}

function normalizeSourceRef(entry) {
  if (typeof entry === "string") {
    const title = sanitizeEvidenceString(entry);
    return title ? { title } : null;
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const normalized = {};
  ["id", "title", "path", "section", "uri", "source_type", "ref_kind", "audience"].forEach((key) => {
    const value = sanitizeEvidenceString(entry[key]);
    if (value) normalized[key] = value;
  });
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeSourceList(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = items.map(normalizeSourceRef).filter(Boolean).slice(0, 20);
  return normalized;
}

function buildEvidenceRefs(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    run_id: sanitizeEvidenceString(source.run_id),
    thread_id: sanitizeEvidenceString(source.thread_id),
    metric_snapshot: sanitizeEvidenceValue(source.metric_snapshot),
    history_window: sanitizeEvidenceValue(source.history_window),
    manual: normalizeSourceList(source.manual),
    runbook: normalizeSourceList(source.runbook),
    doc_source: normalizeSourceList(source.doc_source),
  };
}

function summarizeEvidenceRefs(evidenceRefs = {}) {
  const refs = buildEvidenceRefs(evidenceRefs);
  return {
    run_id: refs.run_id || null,
    thread_id: refs.thread_id || null,
    metric_snapshot_keys: refs.metric_snapshot ? Object.keys(refs.metric_snapshot).slice(0, 10) : [],
    history_window_keys: refs.history_window ? Object.keys(refs.history_window).slice(0, 10) : [],
    manual_count: refs.manual.length,
    runbook_count: refs.runbook.length,
    doc_source_count: refs.doc_source.length,
  };
}

function evidenceRefsToSummary(evidenceRefs = {}) {
  const refs = buildEvidenceRefs(evidenceRefs);
  const lines = [];
  if (refs.run_id) lines.push(`run_id: ${refs.run_id}`);
  if (refs.thread_id) lines.push(`thread_id: ${refs.thread_id}`);
  if (refs.metric_snapshot) {
    lines.push(`metric_snapshot: ${JSON.stringify(refs.metric_snapshot)}`);
  }
  if (refs.history_window) {
    lines.push(`history_window: ${JSON.stringify(refs.history_window)}`);
  }
  if (refs.manual.length) {
    lines.push(`manual: ${refs.manual.map((entry) => JSON.stringify(entry)).join("; ")}`);
  }
  if (refs.runbook.length) {
    lines.push(`runbook: ${refs.runbook.map((entry) => JSON.stringify(entry)).join("; ")}`);
  }
  if (refs.doc_source.length) {
    lines.push(`doc_source: ${refs.doc_source.map((entry) => JSON.stringify(entry)).join("; ")}`);
  }
  return lines.join("\n").trim();
}

module.exports = {
  buildEvidenceRefs,
  evidenceRefsToSummary,
  summarizeEvidenceRefs,
};
