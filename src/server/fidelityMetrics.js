"use strict";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addAvg(state, key, value) {
  const num = asNumber(value);
  if (num === null) return;
  state[key] = state[key] || { sum: 0, count: 0 };
  state[key].sum += num;
  state[key].count += 1;
}

function toAvg(entry) {
  if (!entry || !entry.count) return null;
  return Number((entry.sum / entry.count).toFixed(2));
}

function evidenceOf(run) {
  const ctx = asObject(run && run.context_used);
  const inputs = asObject(run && run.inputs);
  const ctxEvidence = asObject(ctx.fidelity_evidence);
  const inputEvidence = asObject(inputs.fidelity_evidence);
  return Object.keys(ctxEvidence).length > 0 ? ctxEvidence : Object.keys(inputEvidence).length > 0 ? inputEvidence : null;
}

function byTypeOf(evidence) {
  const reasons = asObject(asObject(evidence).diff_reasons);
  return asObject(asObject(reasons.counts).by_type);
}

function topReasonOf(reasonCounts) {
  return (
    Object.entries(asObject(reasonCounts)).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0]?.[0] || "-"
  );
}

function getEnvironmentName(run, evidence) {
  const env = asObject(asObject(evidence).environment);
  if (typeof env.target_environment === "string" && env.target_environment.trim()) {
    return env.target_environment.trim();
  }
  const fidelityEnvironment = asObject(asObject(run && run.context_used).fidelity_environment);
  if (typeof fidelityEnvironment.target_environment === "string" && fidelityEnvironment.target_environment.trim()) {
    return fidelityEnvironment.target_environment.trim();
  }
  return "unknown";
}

function getComponentNames(run) {
  const ctxFigma = asObject(asObject(asObject(run && run.context_used).connection_context).figma);
  const inputFigma = asObject(asObject(asObject(run && run.inputs).connection_context).figma);
  const nodeSummaries = asArray(ctxFigma.node_summaries).length > 0 ? asArray(ctxFigma.node_summaries) : asArray(inputFigma.node_summaries);
  const names = new Set();
  nodeSummaries.forEach((node) => {
    const src = asObject(node);
    const kind = typeof src.component_kind === "string" ? src.component_kind.trim().toLowerCase() : "";
    const name = typeof src.name === "string" ? src.name.trim() : "";
    if (!name) return;
    if (kind === "instance" || kind === "component") {
      names.add(name);
    }
  });
  return Array.from(names);
}

function isFailedRun(run, evidence) {
  const scores = asObject(asObject(evidence).diff_scores);
  const finalScore = asNumber(asObject(scores.final).score);
  const finalStatus = typeof asObject(scores.final).status === "string" ? asObject(scores.final).status : "";
  const runFailed = String((run && run.status) || "").toLowerCase() === "failed";
  return runFailed || finalStatus === "failed" || finalStatus === "incomplete" || (finalScore !== null && finalScore < 95);
}

function buildProjectFidelityMetrics(runs) {
  const list = asArray(runs);
  const averages = {};
  const reasonCounts = {};
  const environmentMap = new Map();
  const componentMap = new Map();
  let scoredRuns = 0;
  let below95Runs = 0;

  list.forEach((run) => {
    const evidence = evidenceOf(run);
    if (!evidence) return;
    const scores = asObject(evidence.diff_scores);
    const finalScore = asNumber(asObject(scores.final).score);
    const structureScore = asNumber(asObject(scores.structure).score);
    const visualScore = asNumber(asObject(scores.visual).score);
    const behaviorScore = asNumber(asObject(scores.behavior).score);
    const executionScore = asNumber(asObject(scores.execution).score);
    const failed = isFailedRun(run, evidence);
    const byType = byTypeOf(evidence);
    const envName = getEnvironmentName(run, evidence);
    const componentNames = getComponentNames(run);

    addAvg(averages, "final", finalScore);
    addAvg(averages, "structure", structureScore);
    addAvg(averages, "visual", visualScore);
    addAvg(averages, "behavior", behaviorScore);
    addAvg(averages, "execution", executionScore);

    if (finalScore !== null) {
      scoredRuns += 1;
      if (finalScore < 95) below95Runs += 1;
    }

    Object.entries(byType).forEach(([reasonType, count]) => {
      const num = Number(count);
      if (!Number.isFinite(num) || num <= 0) return;
      reasonCounts[reasonType] = (reasonCounts[reasonType] || 0) + num;
    });

    if (!environmentMap.has(envName)) {
      environmentMap.set(envName, {
        environment: envName,
        runs: 0,
        failed_runs: 0,
        averages: {},
        reason_counts: {},
      });
    }
    const envStat = environmentMap.get(envName);
    envStat.runs += 1;
    if (failed) envStat.failed_runs += 1;
    addAvg(envStat.averages, "final", finalScore);
    Object.entries(byType).forEach(([reasonType, count]) => {
      const num = Number(count);
      if (!Number.isFinite(num) || num <= 0) return;
      envStat.reason_counts[reasonType] = (envStat.reason_counts[reasonType] || 0) + num;
    });

    componentNames.forEach((name) => {
      if (!componentMap.has(name)) {
        componentMap.set(name, {
          component: name,
          runs: 0,
          failed_runs: 0,
          reason_counts: {},
        });
      }
      const componentStat = componentMap.get(name);
      componentStat.runs += 1;
      if (failed) componentStat.failed_runs += 1;
      Object.entries(byType).forEach(([reasonType, count]) => {
        const num = Number(count);
        if (!Number.isFinite(num) || num <= 0) return;
        componentStat.reason_counts[reasonType] = (componentStat.reason_counts[reasonType] || 0) + num;
      });
    });
  });

  return {
    averages: {
      final: toAvg(averages.final),
      structure: toAvg(averages.structure),
      visual: toAvg(averages.visual),
      behavior: toAvg(averages.behavior),
      execution: toAvg(averages.execution),
    },
    score_progress: {
      runs_with_final_score: scoredRuns,
      below_95_runs: below95Runs,
      below_95_rate: scoredRuns > 0 ? Number(((below95Runs / scoredRuns) * 100).toFixed(2)) : 0,
    },
    top_reasons: Object.entries(reasonCounts)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, 10)
      .map(([reason_type, count]) => ({ reason_type, count: Number(count) || 0 })),
    environment_failure_rates: Array.from(environmentMap.values())
      .map((entry) => ({
        environment: entry.environment,
        runs: entry.runs,
        failed_runs: entry.failed_runs,
        failed_rate: entry.runs > 0 ? Number(((entry.failed_runs / entry.runs) * 100).toFixed(2)) : 0,
        average_final_score: toAvg(entry.averages.final),
        top_reason: topReasonOf(entry.reason_counts),
      }))
      .sort((a, b) => b.failed_rate - a.failed_rate || b.runs - a.runs || a.environment.localeCompare(b.environment)),
    component_failure_rates: Array.from(componentMap.values())
      .map((entry) => ({
        component: entry.component,
        runs: entry.runs,
        failed_runs: entry.failed_runs,
        failed_rate: entry.runs > 0 ? Number(((entry.failed_runs / entry.runs) * 100).toFixed(2)) : 0,
        top_reason: topReasonOf(entry.reason_counts),
      }))
      .sort((a, b) => b.failed_rate - a.failed_rate || b.runs - a.runs || a.component.localeCompare(b.component))
      .slice(0, 20),
  };
}

module.exports = {
  buildProjectFidelityMetrics,
};
