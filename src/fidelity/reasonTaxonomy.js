"use strict";

const REASON_TAXONOMY_VERSION = "phase4-reasons-v1";

const REASON_TYPES = Object.freeze([
  "token_mismatch",
  "layout_constraint_mismatch",
  "component_variant_mismatch",
  "missing_state",
  "content_overflow",
  "font_rendering_mismatch",
  "breakpoint_mismatch",
  "environment_only_mismatch",
  "manual_design_drift",
  "code_drift_from_approved_design",
  "unknown",
]);

const TOKEN_REASON_CODES = new Set([
  "color_changed",
  "spacing_changed",
  "radius_changed",
  "border_changed",
  "typography_changed",
]);

const LAYOUT_REASON_CODES = new Set([
  "parent_changed",
  "slot_changed",
  "visibility_changed",
  "missing_node",
  "extra_node",
  "sizing_changed",
]);

const COMPONENT_REASON_CODES = new Set([
  "instance_variant_changed",
  "component_key_changed",
  "code_component_mapping_changed",
]);

const MISSING_STATE_REASON_CODES = new Set([
  "missing_state_both",
  "missing_state_baseline",
  "missing_state_candidate",
]);

const CONTENT_REASON_CODES = new Set([
  "content_overflow",
  "text_overflow",
  "state_text_changed",
]);

const FONT_RENDERING_REASON_CODES = new Set([
  "font_fallback_mismatch",
  "browser_mismatch",
]);

const BREAKPOINT_REASON_CODES = new Set([
  "viewport_mismatch",
]);

const ENVIRONMENT_ONLY_REASON_CODES = new Set([
  "environment_only_mismatch",
]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function classifyReasonType(reason, axis = "") {
  const src = asObject(reason);
  const reasonCode = asText(src.reason_code);
  const safeAxis = asText(axis) || asText(src.axis);

  if (TOKEN_REASON_CODES.has(reasonCode)) return "token_mismatch";
  if (LAYOUT_REASON_CODES.has(reasonCode)) return "layout_constraint_mismatch";
  if (COMPONENT_REASON_CODES.has(reasonCode)) return "component_variant_mismatch";
  if (MISSING_STATE_REASON_CODES.has(reasonCode)) return "missing_state";
  if (CONTENT_REASON_CODES.has(reasonCode)) return "content_overflow";
  if (FONT_RENDERING_REASON_CODES.has(reasonCode)) return "font_rendering_mismatch";
  if (BREAKPOINT_REASON_CODES.has(reasonCode)) return "breakpoint_mismatch";
  if (ENVIRONMENT_ONLY_REASON_CODES.has(reasonCode)) return "environment_only_mismatch";

  if (reasonCode === "manual_design_drift") return "manual_design_drift";
  if (reasonCode === "code_drift_from_approved_design") return "code_drift_from_approved_design";

  if (safeAxis === "execution" && reasonCode.endsWith("_mismatch")) return "code_drift_from_approved_design";
  if (safeAxis === "structure" && reasonCode) return "code_drift_from_approved_design";
  if (safeAxis === "behavior" && reasonCode === "state_signature_changed") return "code_drift_from_approved_design";

  return "unknown";
}

function annotateReasons(reasons, axis = "") {
  return asArray(reasons).map((item) => {
    const source = asObject(item);
    const reasonType = classifyReasonType(source, axis);
    return {
      ...source,
      axis: asText(axis) || asText(source.axis),
      reason_type: reasonType,
    };
  });
}

function summarizeByType(reasons) {
  const counts = {};
  for (const type of REASON_TYPES) {
    counts[type] = 0;
  }
  for (const item of asArray(reasons)) {
    const type = asText(item && item.reason_type);
    if (!type || !Object.prototype.hasOwnProperty.call(counts, type)) {
      counts.unknown += 1;
      continue;
    }
    counts[type] += 1;
  }
  return counts;
}

function collectClassifiedReasons(diffPayload, options = {}) {
  const payload = asObject(diffPayload);
  const structure = asObject(payload.structure_diff);
  const visual = asObject(payload.visual_diff);
  const behavior = asObject(payload.behavior_diff);
  const execution = asObject(payload.execution_diff);
  const out = [];

  out.push(...annotateReasons(asObject(structure.diffs).reasons, "structure"));
  out.push(...annotateReasons(visual.reasons, "visual"));
  out.push(...annotateReasons(behavior.reasons, "behavior"));
  out.push(...annotateReasons(execution.reasons, "execution"));

  if (options.manual_design_drift === true) {
    out.push({
      axis: "global",
      reason_code: "manual_design_drift",
      reason_type: "manual_design_drift",
    });
  }
  if (options.code_drift_from_approved_design === true) {
    out.push({
      axis: "global",
      reason_code: "code_drift_from_approved_design",
      reason_type: "code_drift_from_approved_design",
    });
  }

  return {
    version: REASON_TAXONOMY_VERSION,
    reasons: out,
    counts: {
      total: out.length,
      by_type: summarizeByType(out),
    },
  };
}

module.exports = {
  REASON_TAXONOMY_VERSION,
  REASON_TYPES,
  classifyReasonType,
  annotateReasons,
  summarizeByType,
  collectClassifiedReasons,
};
