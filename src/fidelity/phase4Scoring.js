"use strict";
const { collectClassifiedReasons } = require("./reasonTaxonomy");

const DEFAULT_WEIGHTS = Object.freeze({
  structure: 0.35,
  visual: 0.35,
  behavior: 0.15,
  execution: 0.15,
});

const DEFAULT_AXIS_THRESHOLDS = Object.freeze({
  structure: 95,
  visual: 95,
  behavior: 95,
  execution: 95,
});

const DEFAULT_FINAL_THRESHOLD = 95;

function asNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeWeights(raw) {
  const source = asObject(raw);
  const weights = {
    structure: asNumber(source.structure, DEFAULT_WEIGHTS.structure),
    visual: asNumber(source.visual, DEFAULT_WEIGHTS.visual),
    behavior: asNumber(source.behavior, DEFAULT_WEIGHTS.behavior),
    execution: asNumber(source.execution, DEFAULT_WEIGHTS.execution),
  };
  const total = weights.structure + weights.visual + weights.behavior + weights.execution;
  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS, sum: 1 };
  }
  return {
    structure: weights.structure / total,
    visual: weights.visual / total,
    behavior: weights.behavior / total,
    execution: weights.execution / total,
    sum: 1,
  };
}

function normalizeThresholds(raw) {
  const source = asObject(raw);
  return {
    structure: clamp(asNumber(source.structure, DEFAULT_AXIS_THRESHOLDS.structure), 0, 100),
    visual: clamp(asNumber(source.visual, DEFAULT_AXIS_THRESHOLDS.visual), 0, 100),
    behavior: clamp(asNumber(source.behavior, DEFAULT_AXIS_THRESHOLDS.behavior), 0, 100),
    execution: clamp(asNumber(source.execution, DEFAULT_AXIS_THRESHOLDS.execution), 0, 100),
  };
}

function readStructureScore(structureDiff) {
  const source = asObject(structureDiff);
  const reproduction = asObject(source.structural_reproduction);
  const rate = asNumber(reproduction.rate, 0);
  return clamp(rate * 100, 0, 100);
}

function readVisualScore(visualDiff) {
  const source = asObject(visualDiff);
  return clamp(asNumber(source.score, 0), 0, 100);
}

function readBehaviorScore(behaviorDiff) {
  const source = asObject(behaviorDiff);
  return clamp(asNumber(source.score, 0), 0, 100);
}

function readExecutionScore(executionDiff) {
  const source = asObject(executionDiff);
  return clamp(asNumber(source.score, 0), 0, 100);
}

function summarizeTargetAlignment(structureDiff) {
  const source = asObject(structureDiff);
  const counts = asObject(source.counts);
  const baselineNodes = Math.max(asNumber(counts.baseline_nodes, 0), 0);
  const missing = Math.max(asNumber(counts.missing_in_candidate, 0), 0);
  const extra = Math.max(asNumber(counts.extra_in_candidate, 0), 0);
  const targetMismatches = Math.max(asNumber(counts.target_mismatches, 0), 0);

  const coverageRate = baselineNodes > 0 ? (baselineNodes - missing) / baselineNodes : 1;
  const scopeIntegrity = extra === 0;
  const targetIdMatch = targetMismatches === 0;
  const targetAlignment100 = coverageRate === 1 && scopeIntegrity && targetIdMatch;

  return {
    baseline_nodes: baselineNodes,
    missing_in_candidate: missing,
    extra_in_candidate: extra,
    target_mismatches: targetMismatches,
    coverage_rate: Number(clamp(coverageRate, 0, 1).toFixed(4)),
    target_id_match: targetIdMatch,
    scope_integrity: scopeIntegrity,
    target_alignment_100: targetAlignment100,
  };
}

function missingAxes(payload) {
  const missing = [];
  if (!payload || typeof payload !== "object") {
    return ["structure", "visual", "behavior", "execution"];
  }
  if (!payload.structure_diff || typeof payload.structure_diff !== "object") missing.push("structure");
  if (!payload.visual_diff || typeof payload.visual_diff !== "object") missing.push("visual");
  if (!payload.behavior_diff || typeof payload.behavior_diff !== "object") missing.push("behavior");
  if (!payload.execution_diff || typeof payload.execution_diff !== "object") missing.push("execution");
  return missing;
}

function toAxisResult(name, score, threshold) {
  const pass = score >= threshold;
  return {
    axis: name,
    score: Number(score.toFixed(2)),
    threshold,
    pass,
    status: pass ? "passed" : "failed",
  };
}

function remediationForGate(gateId) {
  const map = {
    target_alignment_100: "Figma target/page/frame/node の解決結果を再確認し、missing/extra node を 0 にする。",
    structure_major_diff_forbidden: "構造差分の hierarchy/component mapping を優先修正し、major diff を解消する。",
    visual_axis_min: "design token と layout 値を SoT に合わせ、視覚差分スコアを閾値以上に戻す。",
    behavior_axis_min: "hover/active/disabled/loading/modal_open の状態差分を修正する。",
    execution_axis_min: "runtime/network/performance の実行差分を修正し、環境差分のみでないことを確認する。",
    final_score_threshold: "4軸の低スコア軸から順に修正し、総合スコアを閾値以上にする。",
  };
  return map[gateId] || "失敗理由に対応する差分項目を修正する。";
}

function buildRemediations(failedGates, axisResults, executionDiff) {
  const remediations = [];
  for (const gate of failedGates) {
    remediations.push({
      priority: remediations.length + 1,
      type: "gate",
      gate_id: gate.id,
      action: remediationForGate(gate.id),
    });
  }

  const failedAxes = axisResults.filter((axis) => axis.pass === false);
  for (const axis of failedAxes) {
    remediations.push({
      priority: remediations.length + 1,
      type: "axis",
      axis: axis.axis,
      action: `\`${axis.axis}\` のスコアを ${axis.threshold} 以上にするため、reason_code 上位項目を先に修正する。`,
    });
  }

  if (executionDiff && executionDiff.environment_only_mismatch === true) {
    remediations.push({
      priority: remediations.length + 1,
      type: "environment",
      axis: "execution",
      action: "environment_only_mismatch のため、font fallback / viewport / theme / data state / browser 条件を比較時に固定する。",
    });
  }

  return remediations.slice(0, 10);
}

function computePhase4FidelityScore(diffPayload, options = {}) {
  const payload = asObject(diffPayload);
  const missing = missingAxes(payload);
  const weights = normalizeWeights(options.weights);
  const axisThresholds = normalizeThresholds(options.axis_thresholds);
  const finalThreshold = clamp(asNumber(options.final_threshold, DEFAULT_FINAL_THRESHOLD), 0, 100);

  if (missing.length > 0) {
    return {
      status: "incomplete",
      pass: false,
      failure_code: "axis_missing",
      missing_axes: missing,
      final_score: 0,
      threshold: finalThreshold,
      weights,
      axis_results: [],
      hard_gates: [
        {
          id: "axis_presence_4",
          pass: false,
          expected: "all 4 axes present",
          actual: `missing:${missing.join(",")}`,
          severity: "hard_fail",
        },
      ],
      reasons: [
        {
          axis: "global",
          reason_code: "axis_missing",
          detail: { missing_axes: missing },
        },
      ],
      remediations: [
        {
          priority: 1,
          type: "global",
          action: "structure_diff / visual_diff / behavior_diff / execution_diff をすべて生成し直す。",
        },
      ],
    };
  }

  const structureDiff = asObject(payload.structure_diff);
  const visualDiff = asObject(payload.visual_diff);
  const behaviorDiff = asObject(payload.behavior_diff);
  const executionDiff = asObject(payload.execution_diff);
  const reasonCatalog = collectClassifiedReasons(payload, {
    manual_design_drift: Boolean(options.manual_design_drift),
    code_drift_from_approved_design: Boolean(options.code_drift_from_approved_design),
  });

  const targetAlignment = summarizeTargetAlignment(structureDiff);
  const structureScore = readStructureScore(structureDiff);
  const visualScore = readVisualScore(visualDiff);
  const behaviorScore = readBehaviorScore(behaviorDiff);
  const executionScoreRaw = readExecutionScore(executionDiff);
  const executionEnvironmentOnly = executionDiff.environment_only_mismatch === true;
  const executionScoreEffective = executionEnvironmentOnly ? 100 : executionScoreRaw;

  const axisResults = [
    toAxisResult("structure", structureScore, axisThresholds.structure),
    toAxisResult("visual", visualScore, axisThresholds.visual),
    toAxisResult("behavior", behaviorScore, axisThresholds.behavior),
    toAxisResult("execution", executionScoreEffective, axisThresholds.execution),
  ];

  const weightedScore =
    structureScore * weights.structure +
    visualScore * weights.visual +
    behaviorScore * weights.behavior +
    executionScoreEffective * weights.execution;

  const hardGates = [
    {
      id: "target_alignment_100",
      pass: targetAlignment.target_alignment_100,
      expected: "coverage=100%, scope_integrity=true, target_id_match=true",
      actual: `coverage=${targetAlignment.coverage_rate},scope=${targetAlignment.scope_integrity},target_id_match=${targetAlignment.target_id_match}`,
      severity: "hard_fail",
    },
    {
      id: "structure_major_diff_forbidden",
      pass: structureDiff.major_diff_detected !== true,
      expected: "major_diff_detected=false",
      actual: `major_diff_detected=${structureDiff.major_diff_detected === true}`,
      severity: "hard_fail",
    },
    {
      id: "visual_axis_min",
      pass: axisResults[1].pass,
      expected: `visual>=${axisThresholds.visual}`,
      actual: `visual=${axisResults[1].score}`,
      severity: "hard_fail",
    },
    {
      id: "behavior_axis_min",
      pass: axisResults[2].pass,
      expected: `behavior>=${axisThresholds.behavior}`,
      actual: `behavior=${axisResults[2].score}`,
      severity: "hard_fail",
    },
    {
      id: "execution_axis_min",
      pass: executionEnvironmentOnly ? true : axisResults[3].pass,
      expected: executionEnvironmentOnly
        ? "execution implementation mismatch not present"
        : `execution>=${axisThresholds.execution}`,
      actual: executionEnvironmentOnly
        ? "environment_only_mismatch=true"
        : `execution=${axisResults[3].score}`,
      severity: executionEnvironmentOnly ? "info" : "hard_fail",
    },
    {
      id: "final_score_threshold",
      pass: Number(weightedScore.toFixed(2)) >= finalThreshold,
      expected: `final_score>=${finalThreshold}`,
      actual: `final_score=${Number(weightedScore.toFixed(2))}`,
      severity: "hard_fail",
    },
  ];

  const failedHardGates = hardGates.filter((gate) => gate.pass === false && gate.severity === "hard_fail");
  const pass = failedHardGates.length === 0;

  const reasons = [];
  if (!targetAlignment.target_alignment_100) {
    reasons.push({
      axis: "structure",
      reason_code: "target_alignment_not_100",
      detail: targetAlignment,
    });
  }
  if (structureDiff.major_diff_detected === true) {
    reasons.push({
      axis: "structure",
      reason_code: "structure_major_diff_detected",
    });
  }
  for (const axis of axisResults) {
    if (!axis.pass && axis.axis !== "execution") {
      reasons.push({ axis: axis.axis, reason_code: `${axis.axis}_below_threshold`, detail: axis });
    }
  }
  if (!executionEnvironmentOnly && !axisResults[3].pass) {
    reasons.push({ axis: "execution", reason_code: "execution_below_threshold", detail: axisResults[3] });
  }
  if (executionEnvironmentOnly) {
    reasons.push({
      axis: "execution",
      reason_code: "environment_only_mismatch",
      detail: asObject(executionDiff.mismatch_fields).environment || [],
    });
  }

  const status = pass
    ? executionEnvironmentOnly
      ? "passed_with_environment_mismatch"
      : "passed"
    : "failed";

  const failureCode = pass
    ? null
    : reasons.length > 0 && typeof reasons[0].reason_code === "string"
      ? reasons[0].reason_code
      : "fidelity_below_threshold";

  return {
    status,
    pass,
    failure_code: failureCode,
    threshold: finalThreshold,
    final_score: Number(weightedScore.toFixed(2)),
    weights,
    target_alignment: targetAlignment,
    axis_results: axisResults,
    hard_gates: hardGates,
    reasons,
    diff_reasons: reasonCatalog,
    remediations: buildRemediations(failedHardGates, axisResults, executionDiff),
    counts: {
      failed_hard_gates: failedHardGates.length,
      reason_count: reasons.length,
      remediation_count: buildRemediations(failedHardGates, axisResults, executionDiff).length,
    },
    raw_axis_scores: {
      structure: Number(structureScore.toFixed(2)),
      visual: Number(visualScore.toFixed(2)),
      behavior: Number(behaviorScore.toFixed(2)),
      execution: Number(executionScoreRaw.toFixed(2)),
      execution_effective: Number(executionScoreEffective.toFixed(2)),
    },
  };
}

module.exports = {
  computePhase4FidelityScore,
  DEFAULT_WEIGHTS,
  DEFAULT_AXIS_THRESHOLDS,
  DEFAULT_FINAL_THRESHOLD,
};
