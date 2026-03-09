"use strict";
const { annotateReasons, summarizeByType } = require("./reasonTaxonomy");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringList(value) {
  const seen = new Set();
  const out = [];
  for (const item of asArray(value)) {
    const text = asText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeViewport(value) {
  const source = asObject(value);
  return {
    width: asNumber(source.width),
    height: asNumber(source.height),
  };
}

function normalizeBrowser(value) {
  const source = asObject(value);
  return {
    name: asText(source.name),
    version: asText(source.version),
    engine: asText(source.engine),
  };
}

function normalizeStatus(value) {
  const text = asText(value).toLowerCase();
  if (text === "ok" || text === "pass" || text === "passed") return "ok";
  if (text === "error" || text === "fail" || text === "failed") return "error";
  return "unknown";
}

function normalizeExecutionInput(raw) {
  const source = asObject(raw);
  return {
    font_fallback: normalizeStringList(source.font_fallback || source.font_fallbacks),
    viewport: normalizeViewport(source.viewport),
    theme: asText(source.theme),
    data_state: asText(source.data_state),
    browser: normalizeBrowser(source.browser),
    runtime_status: normalizeStatus(source.runtime_status),
    network_contract_status: normalizeStatus(source.network_contract_status),
    performance_guardrail_status: normalizeStatus(source.performance_guardrail_status),
  };
}

function listDiffStrings(baseList, candList) {
  const base = new Set(baseList);
  const cand = new Set(candList);
  const missing = [];
  const extra = [];
  for (const item of base) {
    if (!cand.has(item)) missing.push(item);
  }
  for (const item of cand) {
    if (!base.has(item)) extra.push(item);
  }
  return { missing, extra, changed: missing.length > 0 || extra.length > 0 };
}

function compareExecutionDiff(baselineRaw, candidateRaw, { threshold = 95 } = {}) {
  const baseline = normalizeExecutionInput(baselineRaw);
  const candidate = normalizeExecutionInput(candidateRaw);
  const reasons = [];
  const environmentMismatches = [];
  const executionMismatches = [];

  const fontFallbackDiff = listDiffStrings(baseline.font_fallback, candidate.font_fallback);
  if (fontFallbackDiff.changed) {
    environmentMismatches.push("font_fallback");
    reasons.push({
      category: "execution",
      reason_code: "font_fallback_mismatch",
      baseline: baseline.font_fallback,
      candidate: candidate.font_fallback,
      detail: fontFallbackDiff,
    });
  }

  if (baseline.viewport.width !== candidate.viewport.width || baseline.viewport.height !== candidate.viewport.height) {
    environmentMismatches.push("viewport");
    reasons.push({
      category: "execution",
      reason_code: "viewport_mismatch",
      baseline: baseline.viewport,
      candidate: candidate.viewport,
    });
  }

  if (baseline.theme !== candidate.theme) {
    environmentMismatches.push("theme");
    reasons.push({
      category: "execution",
      reason_code: "theme_mismatch",
      baseline: baseline.theme,
      candidate: candidate.theme,
    });
  }

  if (baseline.data_state !== candidate.data_state) {
    environmentMismatches.push("data_state");
    reasons.push({
      category: "execution",
      reason_code: "data_state_mismatch",
      baseline: baseline.data_state,
      candidate: candidate.data_state,
    });
  }

  if (
    baseline.browser.name !== candidate.browser.name ||
    baseline.browser.version !== candidate.browser.version ||
    baseline.browser.engine !== candidate.browser.engine
  ) {
    environmentMismatches.push("browser");
    reasons.push({
      category: "execution",
      reason_code: "browser_mismatch",
      baseline: baseline.browser,
      candidate: candidate.browser,
    });
  }

  if (baseline.runtime_status !== candidate.runtime_status) {
    executionMismatches.push("runtime_status");
    reasons.push({
      category: "execution",
      reason_code: "runtime_status_mismatch",
      baseline: baseline.runtime_status,
      candidate: candidate.runtime_status,
    });
  }

  if (baseline.network_contract_status !== candidate.network_contract_status) {
    executionMismatches.push("network_contract_status");
    reasons.push({
      category: "execution",
      reason_code: "network_contract_status_mismatch",
      baseline: baseline.network_contract_status,
      candidate: candidate.network_contract_status,
    });
  }

  if (baseline.performance_guardrail_status !== candidate.performance_guardrail_status) {
    executionMismatches.push("performance_guardrail_status");
    reasons.push({
      category: "execution",
      reason_code: "performance_guardrail_status_mismatch",
      baseline: baseline.performance_guardrail_status,
      candidate: candidate.performance_guardrail_status,
    });
  }

  const totalMismatchCount = environmentMismatches.length + executionMismatches.length;
  const totalChecks = 8;
  const score = Math.round(((totalChecks - totalMismatchCount) / totalChecks) * 10000) / 100;
  const environmentOnlyMismatch = environmentMismatches.length > 0 && executionMismatches.length === 0;
  if (environmentOnlyMismatch) {
    reasons.push({
      category: "execution",
      reason_code: "environment_only_mismatch",
      mismatch_fields: environmentMismatches,
    });
  }

  const pass = score >= threshold;
  const classifiedReasons = annotateReasons(reasons, "execution");
  return {
    threshold,
    score,
    pass,
    status: pass ? "good" : "bad",
    environment_only_mismatch: environmentOnlyMismatch,
    mismatch_fields: {
      environment: environmentMismatches,
      execution: executionMismatches,
    },
    baseline,
    candidate,
    reasons: classifiedReasons,
    counts: {
      environment_mismatch_count: environmentMismatches.length,
      execution_mismatch_count: executionMismatches.length,
      reason_count: classifiedReasons.length,
      reason_types: summarizeByType(classifiedReasons),
    },
  };
}

module.exports = {
  compareExecutionDiff,
  normalizeExecutionInput,
};
