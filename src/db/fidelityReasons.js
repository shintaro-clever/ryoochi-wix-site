"use strict";

const { REASON_TAXONOMY_VERSION, REASON_TYPES } = require("../fidelity/reasonTaxonomy");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeReasonItem(raw) {
  const source = asObject(raw);
  const reasonType = asText(source.reason_type);
  const safeReasonType = REASON_TYPES.includes(reasonType) ? reasonType : "unknown";
  return {
    axis: asText(source.axis),
    reason_code: asText(source.reason_code),
    reason_type: safeReasonType,
    detail: source.detail !== undefined ? source.detail : null,
  };
}

function summarizeByType(reasons) {
  const out = {};
  for (const type of REASON_TYPES) {
    out[type] = 0;
  }
  for (const item of reasons) {
    const key = REASON_TYPES.includes(item.reason_type) ? item.reason_type : "unknown";
    out[key] += 1;
  }
  return out;
}

function normalizeFidelityReasonSnapshot(raw) {
  const source = asObject(raw);
  const reasons = asArray(source.reasons).map((item) => normalizeReasonItem(item));
  return {
    version: asText(source.version) || REASON_TAXONOMY_VERSION,
    reasons,
    counts: {
      total: reasons.length,
      by_type: summarizeByType(reasons),
    },
    updated_at: asText(source.updated_at) || new Date().toISOString(),
  };
}

module.exports = {
  normalizeFidelityReasonSnapshot,
};
