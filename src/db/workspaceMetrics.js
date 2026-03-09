"use strict";

const { DEFAULT_TENANT } = require("./sqlite");
const { withRetry } = require("./retry");
const { KINDS, buildPublicId, isUuid } = require("../id/publicIds");
const { listHistory } = require("./history");
const { OBSERVABILITY_ALERT_THRESHOLDS } = require("../server/observabilityAlerts");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonSafe(value) {
  const text = asText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toPublicId(kind, value) {
  const text = asText(value);
  if (!text) return null;
  return isUuid(text) ? buildPublicId(kind, text) : text;
}

function toPublicProjectId(value) {
  return toPublicId(KINDS.project, value);
}

function toPublicThreadId(value) {
  return toPublicId(KINDS.thread, value);
}

function toPublicRunId(value) {
  return toPublicId(KINDS.run, value);
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function sanitizeSecretLike(text) {
  let value = asText(text);
  if (!value) return "";
  const patterns = [
    /(env|vault):\/\/[^\s"'`]+/gi,
    /\b(ghp|gho|ghu|ghs|ghr|github_pat|sk|figd|figma)_[A-Za-z0-9_-]+\b/gi,
    /\bconfirm_token\s*=\s*[^\s,;]+/gi,
    /\bsecret_id\s*=\s*[^\s,;]+/gi,
    /\b(token|password|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
  ];
  patterns.forEach((pattern) => {
    value = value.replace(pattern, "[redacted]");
  });
  return value.trim();
}

function sanitizeMetricLabel(text, fallback = "") {
  const sanitized = sanitizeSecretLike(text);
  return sanitized || fallback;
}

function normalizeList(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const text = asText(item).toLowerCase();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

function normalizeRunStatus(status) {
  const raw = asText(status).toLowerCase();
  if (raw === "completed" || raw === "succeeded" || raw === "ok") return "ok";
  if (raw === "queued" || raw === "running" || raw === "failed" || raw === "skipped") return raw;
  return raw || "unknown";
}

function normalizeOperationStatus(status) {
  const raw = asText(status).toLowerCase();
  if (raw === "succeeded" || raw === "completed") return "ok";
  if (raw === "error") return "failed";
  if (["ok", "failed", "skipped", "confirm_required", "confirmed", "pending", "expired"].includes(raw)) return raw;
  return raw || "unknown";
}

function scoreBandOf(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return null;
  if (num < 80) return "<80";
  if (num < 95) return "80-94.99";
  return ">=95";
}

function addCount(map, key, increment = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + increment);
}

function addNestedCount(map, first, second, increment = 1) {
  if (!first || !second) return;
  if (!map.has(first)) {
    map.set(first, new Map());
  }
  const nested = map.get(first);
  nested.set(second, (nested.get(second) || 0) + increment);
}

function toSortedCountArray(map, keyName, valueName = "count") {
  return Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, [valueName]: count }))
    .sort((a, b) => b[valueName] - a[valueName] || String(a[keyName]).localeCompare(String(b[keyName])));
}

function toSortedNestedCountArray(map, firstName, secondName, valueName = "count") {
  const out = [];
  Array.from(map.entries()).forEach(([first, nested]) => {
    Array.from(nested.entries()).forEach(([second, count]) => {
      out.push({ [firstName]: first, [secondName]: second, [valueName]: count });
    });
  });
  return out.sort(
    (a, b) =>
      b[valueName] - a[valueName] ||
      String(a[firstName]).localeCompare(String(b[firstName])) ||
      String(a[secondName]).localeCompare(String(b[secondName]))
  );
}

function percentile(sortedValues, ratio) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index];
}

function roundPct(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

function computeDurationMs(startAt, endAt) {
  const startMs = Date.parse(asText(startAt));
  const endMs = Date.parse(asText(endAt));
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

function extractReadPlanProviders(readTargets) {
  const targets = asObject(readTargets);
  const providers = [];
  const github = asObject(targets.github);
  const figma = asObject(targets.figma);
  if (firstNonEmptyText(github.repository, github.branch) || asArray(github.file_paths).length > 0) {
    providers.push("github");
  }
  if (firstNonEmptyText(figma.file_key, figma.page_id, figma.frame_id) || asArray(figma.node_ids).length > 0) {
    providers.push("figma");
  }
  return providers;
}

function extractRunProviders(row, inputs) {
  const providers = new Set();
  const addProvider = (value) => {
    const normalized = asText(value).toLowerCase();
    if (normalized) providers.add(normalized);
  };
  addProvider(row.search_provider);
  addProvider(inputs.ai_provider);
  const readPlan = asObject(inputs.external_read_plan);
  extractReadPlanProviders(asObject(readPlan.read_targets)).forEach(addProvider);
  asArray(inputs.planned_actions).forEach((entry) => addProvider(asObject(entry).provider));
  asArray(inputs.external_operations).forEach((entry) => addProvider(asObject(entry).provider));
  const contextUsed = asObject(inputs.context_used);
  asArray(contextUsed.planned_actions).forEach((entry) => addProvider(asObject(entry).provider));
  asArray(contextUsed.external_operations).forEach((entry) => addProvider(asObject(entry).provider));
  return Array.from(providers.values());
}

function extractExternalOperations(inputs) {
  const payload = asObject(inputs);
  const contextUsed = asObject(payload.context_used);
  if (asArray(payload.external_operations).length > 0) {
    return asArray(payload.external_operations);
  }
  return asArray(contextUsed.external_operations);
}

function extractPlannedActions(inputs) {
  const payload = asObject(inputs);
  const contextUsed = asObject(payload.context_used);
  if (asArray(payload.planned_actions).length > 0) {
    return asArray(payload.planned_actions);
  }
  return asArray(contextUsed.planned_actions);
}

function withinTimeRange(value, startAt, endAt) {
  const text = asText(value);
  if (!text) return false;
  if (startAt && text < startAt) return false;
  if (endAt && text > endAt) return false;
  return true;
}

function matchesProviderFilter(values, providerFilter) {
  const filter = normalizeList(providerFilter);
  if (filter.length === 0) return true;
  const candidates = normalizeList(values);
  return candidates.some((provider) => filter.includes(provider));
}

function collectRunRows(db, criteria) {
  const where = ["tenant_id=?"];
  const params = [DEFAULT_TENANT];
  if (criteria.projectInternalId) {
    where.push("project_id=?");
    params.push(criteria.projectInternalId);
  }
  if (criteria.threadInternalId) {
    where.push("thread_id=?");
    params.push(criteria.threadInternalId);
  }
  if (criteria.startAt) {
    where.push("created_at>=?");
    params.push(criteria.startAt);
  }
  if (criteria.endAt) {
    where.push("created_at<=?");
    params.push(criteria.endAt);
  }
  return withRetry(() =>
    db
      .prepare(
        `SELECT id, project_id, thread_id, status, job_type, run_mode, inputs_json, failure_code, search_provider, created_at, updated_at
         FROM runs
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...params)
  );
}

function collectMessageRows(db, criteria) {
  const where = ["m.tenant_id=?"];
  const params = [DEFAULT_TENANT];
  if (criteria.projectInternalId) {
    where.push("t.project_id=?");
    params.push(criteria.projectInternalId);
  }
  if (criteria.threadInternalId) {
    where.push("m.thread_id=?");
    params.push(criteria.threadInternalId);
  }
  if (criteria.startAt) {
    where.push("m.created_at>=?");
    params.push(criteria.startAt);
  }
  if (criteria.endAt) {
    where.push("m.created_at<=?");
    params.push(criteria.endAt);
  }
  return withRetry(() =>
    db
      .prepare(
        `SELECT m.thread_id, t.project_id, m.created_at
         FROM thread_messages m
         JOIN project_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
         WHERE ${where.join(" AND ")}
         ORDER BY m.created_at DESC`
      )
      .all(...params)
  );
}

function collectSearchAuditRows(db, criteria) {
  const where = ["tenant_id=?", "action='workspace.search'"];
  const params = [DEFAULT_TENANT];
  if (criteria.startAt) {
    where.push("created_at>=?");
    params.push(criteria.startAt);
  }
  if (criteria.endAt) {
    where.push("created_at<=?");
    params.push(criteria.endAt);
  }
  return withRetry(() =>
    db
      .prepare(
        `SELECT actor_id, meta_json, created_at
         FROM audit_logs
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...params)
  );
}

function buildEmptyMetrics(criteria = {}) {
  return {
    project_id: criteria.projectId || null,
    thread_id: criteria.threadId || null,
    provider: normalizeList(criteria.providers || []),
    start_at: criteria.startAt || null,
    end_at: criteria.endAt || null,
    generated_at: new Date().toISOString(),
    run_counts: {
      total: 0,
      by_status: {
        queued: 0,
        running: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
      },
      by_project: [],
      by_thread: [],
      by_job_type: [],
    },
    confirm_rate: {
      total: {
        write_plan_recorded: 0,
        confirm_executed: 0,
        pending: 0,
        rate: 0,
      },
      by_provider: [],
      by_operation_type: [],
    },
    operation_counts: {
      total: 0,
      by_provider: [],
      by_provider_and_status: [],
      by_operation_type: [],
    },
    failure_code_distribution: {
      total: 0,
      by_run: [],
      by_provider: [],
    },
    search_count: {
      total: 0,
      by_project: [],
      by_actor: [],
      by_scope: [],
    },
    history_event_volume: {
      total: 0,
      by_event_type: [],
      by_day: [],
      by_run: [],
    },
    retry_count: {
      total: 0,
      by_run: [],
    },
    corrective_write_plan_count: {
      total: 0,
      by_provider: [],
    },
    thread_activity: {
      total_threads: 0,
      messages_per_thread: [],
      active_threads_per_day: [],
      runs_per_thread: [],
    },
    duration: {
      count: 0,
      median_ms: 0,
      p95_ms: 0,
    },
    figma_fidelity_distribution: {
      runs_with_score: 0,
      by_status: [],
      score_bands: [
        { band: "<80", count: 0 },
        { band: "80-94.99", count: 0 },
        { band: ">=95", count: 0 },
      ],
    },
    anomalies: {
      thresholds: OBSERVABILITY_ALERT_THRESHOLDS,
      items: [],
    },
  };
}

function buildRateWindow(rows, predicate) {
  const total = Array.isArray(rows) ? rows.length : 0;
  if (total === 0) return { total: 0, matched: 0, rate_pct: 0 };
  const matched = rows.filter(predicate).length;
  return {
    total,
    matched,
    rate_pct: roundPct((matched / total) * 100),
  };
}

function detectFailedRatioSurge(runSnapshots) {
  const cfg = OBSERVABILITY_ALERT_THRESHOLDS.failed_ratio_surge;
  const rows = Array.isArray(runSnapshots) ? runSnapshots.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) : [];
  const recent = rows.slice(0, cfg.window_runs);
  const baseline = rows.slice(cfg.window_runs, cfg.window_runs * 2);
  if (recent.length < cfg.min_recent_runs || baseline.length < cfg.min_baseline_runs) return null;
  const recentRate = buildRateWindow(recent, (row) => row.failed);
  const baselineRate = buildRateWindow(baseline, (row) => row.failed);
  const delta = roundPct(recentRate.rate_pct - baselineRate.rate_pct);
  if (recentRate.rate_pct >= cfg.alert_failed_rate_pct && delta >= cfg.alert_delta_pct) {
    return {
      code: "failed_ratio_surge",
      severity: "alert",
      title: "Failed ratio surge",
      summary: `failed rate ${recentRate.rate_pct}% (${recentRate.matched}/${recentRate.total}) / baseline ${baselineRate.rate_pct}% (+${delta}pt)`,
      metrics: {
        recent_failed_rate_pct: recentRate.rate_pct,
        baseline_failed_rate_pct: baselineRate.rate_pct,
        delta_pct: delta,
        recent_failed_runs: recentRate.matched,
        recent_total_runs: recentRate.total,
      },
    };
  }
  if (recentRate.rate_pct >= cfg.warning_failed_rate_pct && delta >= cfg.warning_delta_pct) {
    return {
      code: "failed_ratio_surge",
      severity: "warning",
      title: "Failed ratio rising",
      summary: `failed rate ${recentRate.rate_pct}% (${recentRate.matched}/${recentRate.total}) / baseline ${baselineRate.rate_pct}% (+${delta}pt)`,
      metrics: {
        recent_failed_rate_pct: recentRate.rate_pct,
        baseline_failed_rate_pct: baselineRate.rate_pct,
        delta_pct: delta,
        recent_failed_runs: recentRate.matched,
        recent_total_runs: recentRate.total,
      },
    };
  }
  return null;
}

function detectFidelityBelowThresholdStreak(runSnapshots) {
  const cfg = OBSERVABILITY_ALERT_THRESHOLDS.fidelity_below_threshold_streak;
  const rows = Array.isArray(runSnapshots)
    ? runSnapshots
        .filter((row) => row.final_score !== null)
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    : [];
  if (!rows.length) return null;
  let streak = 0;
  rows.forEach((row, index) => {
    if (index < streak + 1 && row.final_score < cfg.threshold_score) {
      streak += 1;
    }
  });
  if (streak >= cfg.alert_streak) {
    return {
      code: "fidelity_below_threshold_streak",
      severity: "alert",
      title: "Fidelity below 95 is continuing",
      summary: `${streak} consecutive runs below ${cfg.threshold_score}`,
      metrics: {
        threshold_score: cfg.threshold_score,
        streak,
      },
    };
  }
  if (streak >= cfg.warning_streak) {
    return {
      code: "fidelity_below_threshold_streak",
      severity: "warning",
      title: "Fidelity below 95 repeated",
      summary: `${streak} consecutive runs below ${cfg.threshold_score}`,
      metrics: {
        threshold_score: cfg.threshold_score,
        streak,
      },
    };
  }
  return null;
}

function detectConfirmPostFailureRateSpike(runSnapshots) {
  const cfg = OBSERVABILITY_ALERT_THRESHOLDS.confirm_post_failure_rate_spike;
  const rows = Array.isArray(runSnapshots)
    ? runSnapshots.filter((row) => row.confirm_executed_count > 0).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    : [];
  const recent = rows.slice(0, cfg.window_runs);
  const baseline = rows.slice(cfg.window_runs, cfg.window_runs * 2);
  if (recent.length < cfg.min_recent_runs || baseline.length < cfg.min_baseline_runs) return null;
  const recentRate = buildRateWindow(recent, (row) => row.failed);
  const baselineRate = buildRateWindow(baseline, (row) => row.failed);
  const delta = roundPct(recentRate.rate_pct - baselineRate.rate_pct);
  if (recentRate.rate_pct >= cfg.alert_failed_rate_pct && delta >= cfg.alert_delta_pct) {
    return {
      code: "confirm_post_failure_rate_spike",
      severity: "alert",
      title: "Post-confirm failures increased",
      summary: `confirmed-run failed rate ${recentRate.rate_pct}% / baseline ${baselineRate.rate_pct}% (+${delta}pt)`,
      metrics: {
        recent_failed_rate_pct: recentRate.rate_pct,
        baseline_failed_rate_pct: baselineRate.rate_pct,
        delta_pct: delta,
        recent_failed_runs: recentRate.matched,
        recent_total_runs: recentRate.total,
      },
    };
  }
  if (recentRate.rate_pct >= cfg.warning_failed_rate_pct && delta >= cfg.warning_delta_pct) {
    return {
      code: "confirm_post_failure_rate_spike",
      severity: "warning",
      title: "Post-confirm failure rate rising",
      summary: `confirmed-run failed rate ${recentRate.rate_pct}% / baseline ${baselineRate.rate_pct}% (+${delta}pt)`,
      metrics: {
        recent_failed_rate_pct: recentRate.rate_pct,
        baseline_failed_rate_pct: baselineRate.rate_pct,
        delta_pct: delta,
        recent_failed_runs: recentRate.matched,
        recent_total_runs: recentRate.total,
      },
    };
  }
  return null;
}

function listWorkspaceMetrics(db, criteria) {
  const metrics = buildEmptyMetrics(criteria);
  const runRows = collectRunRows(db, criteria);
  const messageRows = collectMessageRows(db, criteria);
  const searchRows = collectSearchAuditRows(db, criteria);
  const historyItems = listHistory(db, {
    projectInternalId: criteria.projectInternalId,
    threadInternalId: criteria.threadInternalId,
    runInternalId: null,
    startAt: criteria.startAt || "",
    endAt: criteria.endAt || "",
    eventTypes: [],
    providers: normalizeList(criteria.providers || []),
    statuses: [],
  });

  const byProject = new Map();
  const byThread = new Map();
  const byJobType = new Map();
  const confirmByProvider = new Map();
  const confirmByProviderMeta = new Map();
  const confirmByOperationType = new Map();
  const confirmByOperationMeta = new Map();
  const operationByProvider = new Map();
  const operationByProviderStatus = new Map();
  const operationByType = new Map();
  const failureByRun = new Map();
  const failureByProvider = new Map();
  const searchByProject = new Map();
  const searchByActor = new Map();
  const searchByScope = new Map();
  const historyByType = new Map();
  const historyByDay = new Map();
  const historyByRun = new Map();
  const retryByRun = new Map();
  const correctiveWritePlanByProvider = new Map();
  const messagesPerThread = new Map();
  const runsPerThread = new Map();
  const activeThreadsPerDay = new Map();
  const fidelityStatus = new Map();
  const fidelityBands = new Map([
    ["<80", 0],
    ["80-94.99", 0],
    [">=95", 0],
  ]);
  const durationValues = [];
  const activeThreadIds = new Set();
  const runSnapshots = [];

  runRows.forEach((row) => {
    const inputs = parseJsonSafe(row.inputs_json);
    const providers = extractRunProviders(row, inputs);
    if (!matchesProviderFilter(providers, criteria.providers)) {
      return;
    }

    const publicProjectId = toPublicProjectId(row.project_id);
    const publicThreadId = toPublicThreadId(row.thread_id);
    const publicRunId = toPublicRunId(row.id);
    const runStatus = normalizeRunStatus(row.status);
    const jobType = firstNonEmptyText(row.job_type, row.run_mode, "unknown");
    let confirmExecutedCount = 0;

    metrics.run_counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(metrics.run_counts.by_status, runStatus)) {
      metrics.run_counts.by_status[runStatus] += 1;
    }
    addCount(byProject, publicProjectId);
    addCount(byThread, publicThreadId);
    addCount(byJobType, jobType);

    if (publicThreadId) {
      addCount(runsPerThread, publicThreadId);
      activeThreadIds.add(publicThreadId);
      addCount(activeThreadsPerDay, `${asText(row.created_at).slice(0, 10)}::${publicThreadId}`);
    }

    const durationMs = computeDurationMs(row.created_at, row.updated_at);
    if (durationMs !== null) {
      durationValues.push(durationMs);
    }

    if (runStatus === "failed") {
      const runFailureCode = sanitizeMetricLabel(firstNonEmptyText(row.failure_code), "unknown_failure");
      addCount(failureByRun, `${publicRunId}::${runFailureCode}`);
      addCount(failureByProvider, `run::workspace::${runFailureCode}`);
      metrics.failure_code_distribution.total += 1;
    }

    const plannedActions = extractPlannedActions(inputs);
    plannedActions.forEach((entry) => {
      const planned = asObject(entry);
      const provider = asText(planned.provider).toLowerCase() || "unknown";
      if (!matchesProviderFilter([provider], criteria.providers)) {
        return;
      }
      const operationType = firstNonEmptyText(planned.operation_type, "write");
      const keyProvider = `${provider}::${operationType}`;
      if (!confirmByProviderMeta.has(keyProvider)) {
        confirmByProviderMeta.set(keyProvider, { planned: 0, confirmed: 0 });
      }
      const providerEntry = confirmByProviderMeta.get(keyProvider);
      providerEntry.planned += 1;

      if (!confirmByOperationMeta.has(operationType)) {
        confirmByOperationMeta.set(operationType, { planned: 0, confirmed: 0 });
      }
      const opEntry = confirmByOperationMeta.get(operationType);
      opEntry.planned += 1;

      metrics.confirm_rate.total.write_plan_recorded += 1;
      if (planned.confirmed_at) {
        confirmExecutedCount += 1;
        providerEntry.confirmed += 1;
        opEntry.confirmed += 1;
        metrics.confirm_rate.total.confirm_executed += 1;
      }
    });

    const externalOperations = extractExternalOperations(inputs);
    externalOperations.forEach((entry) => {
      const operation = asObject(entry);
      const provider = asText(operation.provider).toLowerCase() || "unknown";
      if (!matchesProviderFilter([provider], criteria.providers)) {
        return;
      }
      const operationType = firstNonEmptyText(operation.operation_type, "external_operation");
      const result = asObject(operation.result);
      const status = normalizeOperationStatus(result.status);
      metrics.operation_counts.total += 1;
      addCount(operationByProvider, provider);
      addNestedCount(operationByProviderStatus, provider, status);
      addCount(operationByType, operationType);

      const failureCode = sanitizeMetricLabel(result.failure_code);
      if (failureCode) {
        metrics.failure_code_distribution.total += 1;
        addCount(failureByRun, `${publicRunId}::${failureCode}`);
        addCount(failureByProvider, `external_operation::${provider}::${failureCode}`);
      }

      if (operationType === "fidelity.corrective_action_write_plan") {
        metrics.corrective_write_plan_count.total += 1;
        const correctiveProvider = asText(asObject(operation.artifacts).provider).toLowerCase() || "unknown";
        addCount(correctiveWritePlanByProvider, correctiveProvider);
      }

      if (operationType.includes("retry") || firstNonEmptyText(result.reason).toLowerCase().includes("retry")) {
        metrics.retry_count.total += 1;
        addCount(retryByRun, publicRunId);
      }
    });

    const payload = asObject(inputs.context_used).fidelity_evidence || inputs.fidelity_evidence;
    const fidelityEvidence = asObject(payload);
    const phase4Score = asObject(inputs.phase4_score);
    const finalScoreFromEvidence = asNumber(asObject(asObject(fidelityEvidence.diff_scores).final).score);
    const finalScoreFromPhase4 = asNumber(phase4Score.final_score);
    const finalScoreFromInput = asNumber(inputs.fidelity_score);
    const finalScore =
      finalScoreFromEvidence !== null
        ? finalScoreFromEvidence
        : finalScoreFromPhase4 !== null
          ? finalScoreFromPhase4
          : finalScoreFromInput;
    const finalStatus = firstNonEmptyText(
      asObject(asObject(fidelityEvidence.diff_scores).final).status,
      phase4Score.status,
      inputs.fidelity_status
    ).toLowerCase();
    if (finalScore !== null) {
      metrics.figma_fidelity_distribution.runs_with_score += 1;
      const band = scoreBandOf(finalScore);
      if (band) {
        addCount(fidelityBands, band);
      }
    }
    if (finalStatus) {
      addCount(fidelityStatus, finalStatus);
    }

    runSnapshots.push({
      run_id: publicRunId,
      project_id: publicProjectId,
      thread_id: publicThreadId,
      created_at: asText(row.created_at),
      updated_at: asText(row.updated_at),
      failed: runStatus === "failed",
      final_score: finalScore !== null ? finalScore : null,
      confirm_executed_count: confirmExecutedCount,
    });
  });

  messageRows.forEach((row) => {
    const publicThreadId = toPublicThreadId(row.thread_id);
    if (!publicThreadId) return;
    addCount(messagesPerThread, publicThreadId);
    activeThreadIds.add(publicThreadId);
    addCount(activeThreadsPerDay, `${asText(row.created_at).slice(0, 10)}::${publicThreadId}`);
  });

  searchRows.forEach((row) => {
    const meta = parseJsonSafe(row.meta_json);
    const projectId = asText(meta.project_id) || null;
    const threadId = asText(meta.thread_id) || null;
    if (criteria.projectId && projectId !== criteria.projectId) return;
    if (criteria.threadId && threadId !== criteria.threadId) return;
    const providerFilter = normalizeList(meta.provider_filter);
    if (!matchesProviderFilter(providerFilter, criteria.providers)) return;
    metrics.search_count.total += 1;
    addCount(searchByProject, projectId || "workspace");
    addCount(
      searchByActor,
      sanitizeMetricLabel(firstNonEmptyText(asObject(meta.actor).id, meta.requested_by, row.actor_id), "anonymous")
    );
    asArray(meta.scope).forEach((scope) => addCount(searchByScope, asText(scope)));
  });

  historyItems.forEach((item) => {
    metrics.history_event_volume.total += 1;
    addCount(historyByType, asText(item.event_type));
    addCount(historyByDay, asText(item.recorded_at).slice(0, 10));
    const related = asObject(item.related_ids);
    addCount(historyByRun, asText(related.run_id));
  });

  metrics.run_counts.by_project = toSortedCountArray(byProject, "project_id");
  metrics.run_counts.by_thread = toSortedCountArray(byThread, "thread_id");
  metrics.run_counts.by_job_type = toSortedCountArray(byJobType, "job_type");

  metrics.confirm_rate.total.pending =
    metrics.confirm_rate.total.write_plan_recorded - metrics.confirm_rate.total.confirm_executed;
  metrics.confirm_rate.total.rate =
    metrics.confirm_rate.total.write_plan_recorded > 0
      ? Number(
          ((metrics.confirm_rate.total.confirm_executed / metrics.confirm_rate.total.write_plan_recorded) * 100).toFixed(2)
        )
      : 0;
  metrics.confirm_rate.by_provider = Array.from(confirmByProviderMeta.entries())
    .map(([key, value]) => {
      const [provider, operationType] = key.split("::");
      return {
        provider,
        operation_type: operationType,
        write_plan_recorded: value.planned,
        confirm_executed: value.confirmed,
        pending: value.planned - value.confirmed,
        rate: value.planned > 0 ? Number(((value.confirmed / value.planned) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.write_plan_recorded - a.write_plan_recorded || a.provider.localeCompare(b.provider));
  metrics.confirm_rate.by_operation_type = Array.from(confirmByOperationMeta.entries())
    .map(([operationType, value]) => ({
      operation_type: operationType,
      write_plan_recorded: value.planned,
      confirm_executed: value.confirmed,
      pending: value.planned - value.confirmed,
      rate: value.planned > 0 ? Number(((value.confirmed / value.planned) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.write_plan_recorded - a.write_plan_recorded || a.operation_type.localeCompare(b.operation_type));

  metrics.operation_counts.by_provider = toSortedCountArray(operationByProvider, "provider");
  metrics.operation_counts.by_provider_and_status = toSortedNestedCountArray(
    operationByProviderStatus,
    "provider",
    "status"
  );
  metrics.operation_counts.by_operation_type = toSortedCountArray(operationByType, "operation_type");

  metrics.failure_code_distribution.by_run = Array.from(failureByRun.entries())
    .map(([key, count]) => {
      const [runId, failureCode] = key.split("::");
      return { run_id: runId, failure_code: failureCode, count };
    })
    .sort((a, b) => b.count - a.count || a.run_id.localeCompare(b.run_id) || a.failure_code.localeCompare(b.failure_code));
  metrics.failure_code_distribution.by_provider = Array.from(failureByProvider.entries())
    .map(([key, count]) => {
      const [source, provider, failureCode] = key.split("::");
      return { source, provider, failure_code: failureCode, count };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.source.localeCompare(b.source) ||
        a.provider.localeCompare(b.provider) ||
        a.failure_code.localeCompare(b.failure_code)
    );

  metrics.search_count.by_project = toSortedCountArray(searchByProject, "project_id");
  metrics.search_count.by_actor = toSortedCountArray(searchByActor, "actor");
  metrics.search_count.by_scope = toSortedCountArray(searchByScope, "scope");

  metrics.history_event_volume.by_event_type = toSortedCountArray(historyByType, "event_type");
  metrics.history_event_volume.by_day = toSortedCountArray(historyByDay, "day");
  metrics.history_event_volume.by_run = toSortedCountArray(historyByRun, "run_id");

  metrics.retry_count.by_run = toSortedCountArray(retryByRun, "run_id");

  metrics.corrective_write_plan_count.by_provider = toSortedCountArray(correctiveWritePlanByProvider, "provider");

  metrics.thread_activity.total_threads = activeThreadIds.size;
  metrics.thread_activity.messages_per_thread = toSortedCountArray(messagesPerThread, "thread_id");
  metrics.thread_activity.runs_per_thread = toSortedCountArray(runsPerThread, "thread_id");
  metrics.thread_activity.active_threads_per_day = Array.from(activeThreadsPerDay.entries())
    .reduce((map, [key]) => {
      const [day] = key.split("::");
      addCount(map, day);
      return map;
    }, new Map());
  metrics.thread_activity.active_threads_per_day = toSortedCountArray(
    metrics.thread_activity.active_threads_per_day,
    "day"
  );

  durationValues.sort((a, b) => a - b);
  metrics.duration.count = durationValues.length;
  metrics.duration.median_ms = durationValues.length > 0 ? percentile(durationValues, 0.5) : 0;
  metrics.duration.p95_ms = durationValues.length > 0 ? percentile(durationValues, 0.95) : 0;

  metrics.figma_fidelity_distribution.by_status = toSortedCountArray(fidelityStatus, "status");
  metrics.figma_fidelity_distribution.score_bands = ["<80", "80-94.99", ">=95"].map((band) => ({
    band,
    count: fidelityBands.get(band) || 0,
  }));
  metrics.anomalies.items = [
    detectFailedRatioSurge(runSnapshots),
    detectFidelityBelowThresholdStreak(runSnapshots),
    detectConfirmPostFailureRateSpike(runSnapshots),
  ]
    .filter(Boolean)
    .sort((a, b) => {
      const severityRank = { alert: 0, warning: 1 };
      return (severityRank[a.severity] || 9) - (severityRank[b.severity] || 9) || a.code.localeCompare(b.code);
    });

  return metrics;
}

module.exports = {
  buildEmptyMetrics,
  listWorkspaceMetrics,
};
