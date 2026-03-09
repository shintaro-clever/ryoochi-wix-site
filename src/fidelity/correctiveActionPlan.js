"use strict";

const { collectClassifiedReasons } = require("./reasonTaxonomy");
const { normalizeFidelityReasonSnapshot } = require("../db/fidelityReasons");

const ACTION_VERSION = "phase4-corrective-action-plan-v1";

const CATEGORY_PRIORITY = Object.freeze({
  state_addition: 1,
  component_swap: 2,
  token_fix: 3,
  layout_fix: 4,
  code_update: 5,
  environment_alignment: 6,
  design_review: 7,
  investigation: 8,
});

const CATEGORY_TARGETS = Object.freeze({
  token_fix: ["src/fidelity/*", "tests/*"],
  layout_fix: ["src/fidelity/*", "src/server/*", "tests/*"],
  component_swap: ["src/fidelity/*", "src/server/*", "tests/*"],
  state_addition: ["src/server/*", "tests/*"],
  code_update: ["src/fidelity/*", "src/server/*", "tests/*"],
  environment_alignment: ["src/server/*", "tests/*"],
  design_review: ["src/fidelity/*", "src/server/*", "tests/*"],
  investigation: ["src/fidelity/*", "src/server/*", "tests/*"],
});

const CATEGORY_PROVIDERS = Object.freeze({
  token_fix: ["github", "figma"],
  layout_fix: ["github", "figma"],
  component_swap: ["github", "figma"],
  state_addition: ["github"],
  code_update: ["github"],
  environment_alignment: ["github"],
  design_review: [],
  investigation: [],
});

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildReasonSnapshot(payload) {
  const source = asObject(payload);
  if (source.fidelity_reasons && typeof source.fidelity_reasons === "object") {
    return normalizeFidelityReasonSnapshot(source.fidelity_reasons);
  }
  const driftSignals = asObject(source.drift_signals);
  const collected = collectClassifiedReasons(source, {
    manual_design_drift: Boolean(driftSignals.manual_design_drift || source.manual_design_drift),
    code_drift_from_approved_design: Boolean(
      driftSignals.code_drift_from_approved_design || source.code_drift_from_approved_design
    ),
  });
  return normalizeFidelityReasonSnapshot(collected);
}

function makeDescriptor(category, title, recommendation) {
  return { category, title, recommendation };
}

function describeReason(reason) {
  const reasonType = asText(reason.reason_type);
  const reasonCode = asText(reason.reason_code);

  if (reasonType === "token_mismatch") {
    return makeDescriptor(
      "token_fix",
      "token 修正",
      "color / spacing / radius / border / typography token を基準デザインに合わせて揃える。"
    );
  }
  if (reasonType === "layout_constraint_mismatch") {
    return makeDescriptor(
      "layout_fix",
      "layout 修正",
      "parent-child, slot, visibility, sizing, auto layout 制約を基準構造に合わせて戻す。"
    );
  }
  if (reasonType === "component_variant_mismatch") {
    return makeDescriptor(
      "component_swap",
      "component 差替え",
      "component key / ref_id / variant の対応を見直し、承認済みデザインと同じ実装に差し替える。"
    );
  }
  if (reasonType === "missing_state") {
    return makeDescriptor(
      "state_addition",
      "state 追加",
      "不足している UI state と遷移条件を実装し、必要な capture state も追加する。"
    );
  }
  if (reasonType === "content_overflow") {
    return makeDescriptor(
      "layout_fix",
      "layout 修正",
      "overflow が出ている text/layout の制約を調整し、折返しと幅・高さ条件を基準に合わせる。"
    );
  }
  if (reasonType === "font_rendering_mismatch") {
    return makeDescriptor(
      "environment_alignment",
      "environment 条件修正",
      "font fallback と browser 条件を固定し、比較環境と実行環境の rendering 差を減らす。"
    );
  }
  if (reasonType === "breakpoint_mismatch") {
    return makeDescriptor(
      "layout_fix",
      "layout 修正",
      "viewport 条件ごとの breakpoint と responsive layout を基準値に合わせて調整する。"
    );
  }
  if (reasonType === "environment_only_mismatch") {
    return makeDescriptor(
      "environment_alignment",
      "environment 条件修正",
      "viewport / theme / data_state / browser / font fallback を固定し、diff 対象外の環境差だけを先に解消する。"
    );
  }
  if (reasonType === "manual_design_drift") {
    return makeDescriptor(
      "design_review",
      "design レビュー",
      "承認済み Figma と運用中デザインの SoT を再確認し、どちらを正とするかを確定してから実装修正に入る。"
    );
  }
  if (reasonType === "code_drift_from_approved_design") {
    if (reasonCode === "state_signature_changed") {
      return makeDescriptor(
        "state_addition",
        "state 追加",
        "state signature がずれているため、状態遷移・props・表示条件を承認済み仕様に合わせる。"
      );
    }
    if (
      reasonCode === "runtime_status_mismatch" ||
      reasonCode === "network_contract_status_mismatch" ||
      reasonCode === "performance_guardrail_status_mismatch"
    ) {
      return makeDescriptor(
        "code_update",
        "state / code 修正",
        "runtime・network・performance の実行差分を生んでいるロジックを修正し、比較条件下で同じ結果に揃える。"
      );
    }
    return makeDescriptor(
      "code_update",
      "state / code 修正",
      "承認済みデザインから逸脱した code path を特定し、構造・挙動・実行結果が一致するように修正する。"
    );
  }
  return makeDescriptor(
    "investigation",
    "調査",
    "reason_code の詳細を確認し、token/layout/component/state のどこで差分が発生しているかを切り分ける。"
  );
}

function buildActionFromGroup(key, reasons, descriptor) {
  const axes = Array.from(new Set(reasons.map((item) => asText(item.axis)).filter(Boolean)));
  const reasonTypes = Array.from(new Set(reasons.map((item) => asText(item.reason_type)).filter(Boolean)));
  const reasonCodes = Array.from(new Set(reasons.map((item) => asText(item.reason_code)).filter(Boolean)));
  return {
    key,
    category: descriptor.category,
    priority: CATEGORY_PRIORITY[descriptor.category] || 99,
    title: descriptor.title,
    rationale: `${reasons.length} 件の差分が ${descriptor.category} に集約されたため、同種の修正をまとめて優先する。`,
    recommendation: descriptor.recommendation,
    axes,
    reason_types: reasonTypes,
    reason_codes: reasonCodes,
    reason_count: reasons.length,
    suggested_target_paths: CATEGORY_TARGETS[descriptor.category] || CATEGORY_TARGETS.investigation,
    eligible_providers: CATEGORY_PROVIDERS[descriptor.category] || [],
  };
}

function summarizeCategories(actions) {
  const out = {};
  actions.forEach((action) => {
    out[action.category] = (out[action.category] || 0) + action.reason_count;
  });
  return out;
}

function buildCorrectiveActionPlan(payload, options = {}) {
  const reasonSnapshot = buildReasonSnapshot(payload);
  const reasons = asArray(reasonSnapshot.reasons);
  const maxActions = Number.isFinite(Number(options.max_actions))
    ? Math.max(1, Math.floor(Number(options.max_actions)))
    : 10;

  if (reasons.length === 0) {
    return {
      version: ACTION_VERSION,
      generated_at: new Date().toISOString(),
      status: "no_diff",
      summary: {
        total_reasons: 0,
        total_actions: 0,
        categories: {},
      },
      actions: [],
      source_reason_snapshot: reasonSnapshot,
    };
  }

  const grouped = new Map();
  reasons.forEach((reason) => {
    const descriptor = describeReason(reason);
    const key = descriptor.category;
    if (!grouped.has(key)) {
      grouped.set(key, { descriptor, reasons: [] });
    }
    grouped.get(key).reasons.push(reason);
  });

  const actions = Array.from(grouped.entries())
    .map(([key, entry]) => buildActionFromGroup(key, entry.reasons, entry.descriptor))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.reason_count !== a.reason_count) return b.reason_count - a.reason_count;
      return a.category.localeCompare(b.category);
    })
    .slice(0, maxActions)
    .map((action, index) => ({
      ...action,
      priority: index + 1,
    }));

  return {
    version: ACTION_VERSION,
    generated_at: new Date().toISOString(),
    status: "ok",
    summary: {
      total_reasons: reasons.length,
      total_actions: actions.length,
      categories: summarizeCategories(actions),
    },
    actions,
    source_reason_snapshot: reasonSnapshot,
  };
}

module.exports = {
  ACTION_VERSION,
  buildCorrectiveActionPlan,
};
