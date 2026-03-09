"use strict";
const { annotateReasons, summarizeByType } = require("./reasonTaxonomy");

const REQUIRED_STATES = ["hover", "active", "disabled", "loading", "modal_open"];

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value, fallback = null) {
  if (typeof value === "boolean") return value;
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStateEntry(raw) {
  const source = asObject(raw);
  const attrs = asObject(source.attributes);
  return {
    state: asText(source.state).toLowerCase(),
    status: asText(source.status || "ok").toLowerCase() || "ok",
    artifact_path: asText(source.artifact_path || source.path),
    signature: asText(source.signature || source.hash || source.checksum),
    attributes: {
      visible: asBoolean(attrs.visible, asBoolean(source.visible, null)),
      enabled: asBoolean(attrs.enabled, asBoolean(source.enabled, null)),
      loading: asBoolean(attrs.loading, asBoolean(source.loading, null)),
      modal_open: asBoolean(attrs.modal_open, asBoolean(source.modal_open, null)),
      text: asText(attrs.text || source.text),
    },
  };
}

function indexStates(list) {
  const map = new Map();
  const arr = Array.isArray(list) ? list : [];
  for (const item of arr) {
    const normalized = normalizeStateEntry(item);
    if (!normalized.state) continue;
    map.set(normalized.state, normalized);
  }
  return map;
}

function compareStatePair(state, baseline, candidate) {
  const mismatch_fields = [];
  const reasons = [];
  if (!baseline && !candidate) {
    return {
      state,
      status: "error",
      pass: false,
      mismatch_fields: ["state"],
      reasons: [{ category: "behavior", reason_code: "missing_state_both", state }],
    };
  }
  if (!baseline) {
    return {
      state,
      status: "error",
      pass: false,
      mismatch_fields: ["baseline_state"],
      reasons: [{ category: "behavior", reason_code: "missing_state_baseline", state }],
    };
  }
  if (!candidate) {
    return {
      state,
      status: "error",
      pass: false,
      mismatch_fields: ["candidate_state"],
      reasons: [{ category: "behavior", reason_code: "missing_state_candidate", state }],
    };
  }
  const fieldsToCompare = ["visible", "enabled", "loading", "modal_open", "text"];
  for (const field of fieldsToCompare) {
    const b = baseline.attributes[field];
    const c = candidate.attributes[field];
    if (b === null || b === undefined || c === null || c === undefined) continue;
    if (b !== c) {
      mismatch_fields.push(field);
      reasons.push({
        category: "behavior",
        reason_code: `state_${field}_changed`,
        state,
        field,
        baseline: b,
        candidate: c,
      });
    }
  }
  if (baseline.signature && candidate.signature && baseline.signature !== candidate.signature) {
    mismatch_fields.push("signature");
    reasons.push({
      category: "behavior",
      reason_code: "state_signature_changed",
      state,
      baseline: baseline.signature,
      candidate: candidate.signature,
    });
  }
  const pass = mismatch_fields.length === 0;
  return {
    state,
    status: pass ? "ok" : "diff",
    pass,
    mismatch_fields,
    reasons,
    baseline: {
      status: baseline.status,
      artifact_path: baseline.artifact_path,
      signature: baseline.signature,
      attributes: baseline.attributes,
    },
    candidate: {
      status: candidate.status,
      artifact_path: candidate.artifact_path,
      signature: candidate.signature,
      attributes: candidate.attributes,
    },
  };
}

function compareBehaviorDiff(
  baselineStates,
  candidateStates,
  { threshold = 95, requiredStates = REQUIRED_STATES } = {}
) {
  const required = Array.isArray(requiredStates) && requiredStates.length > 0
    ? requiredStates.map((item) => asText(item).toLowerCase()).filter(Boolean)
    : REQUIRED_STATES;
  const baselineMap = indexStates(baselineStates);
  const candidateMap = indexStates(candidateStates);
  const state_results = [];
  for (const state of required) {
    const row = compareStatePair(state, baselineMap.get(state), candidateMap.get(state));
    state_results.push(row);
  }
  const passCount = state_results.filter((row) => row.pass).length;
  const score = Math.round((passCount / Math.max(required.length, 1)) * 10000) / 100;
  const pass = score >= threshold;
  const classifiedStateResults = state_results.map((row) => ({
    ...row,
    reasons: annotateReasons(row.reasons, "behavior"),
  }));
  const classifiedReasons = classifiedStateResults.flatMap((row) => row.reasons);
  return {
    threshold,
    score,
    pass,
    status: pass ? "good" : "bad",
    required_states: required,
    state_results: classifiedStateResults,
    reasons: classifiedReasons,
    counts: {
      required_states: required.length,
      compared_states: classifiedStateResults.length,
      passed_states: passCount,
      failed_states: classifiedStateResults.length - passCount,
      reasons: classifiedReasons.length,
      reason_types: summarizeByType(classifiedReasons),
    },
  };
}

module.exports = {
  compareBehaviorDiff,
  REQUIRED_STATES,
};
