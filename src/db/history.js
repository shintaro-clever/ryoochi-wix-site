"use strict";

const { DEFAULT_TENANT } = require("./sqlite");
const { withRetry } = require("./retry");
const { KINDS, buildPublicId, isUuid } = require("../id/publicIds");
const { buildExternalAuditView } = require("../api/runs");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function toPublicAiSettingId(value) {
  return toPublicId(KINDS.ai_setting, value);
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
  return value.replace(/\s+/g, " ").trim();
}

function summarizeText(value, max = 160) {
  const text = sanitizeSecretLike(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function normalizeRunStatus(status) {
  const raw = asText(status).toLowerCase();
  if (raw === "completed") return "succeeded";
  if (["queued", "running", "succeeded", "failed", "cancelled"].includes(raw)) return raw;
  return raw || "unknown";
}

function normalizeOperationStatus(status) {
  const raw = asText(status).toLowerCase();
  if (raw === "succeeded") return "ok";
  if (["ok", "skipped", "error", "confirm_required", "confirmed", "pending", "expired"].includes(raw)) return raw;
  return raw || "unknown";
}

function normalizeStatus(value) {
  return asText(value).toLowerCase();
}

function withinTimeRange(ts, startAt, endAt) {
  const value = asText(ts);
  if (!value) return false;
  if (startAt && value < startAt) return false;
  if (endAt && value > endAt) return false;
  return true;
}

function matchesFilter(value, filter) {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  return filter.includes(normalizeStatus(value));
}

function buildActor(raw = {}) {
  const source = asObject(raw);
  return {
    requested_by: firstNonEmptyText(source.requested_by, source.id, source.user_id) || null,
    ai_setting_id: toPublicAiSettingId(source.ai_setting_id) || null,
    role: firstNonEmptyText(source.role, source.author) || null,
  };
}

function buildRelatedIds({ projectId = null, threadId = null, runId = null, messageId = null, actionId = null } = {}) {
  return {
    project_id: projectId,
    thread_id: threadId,
    run_id: runId,
    message_id: messageId,
    action_id: actionId,
  };
}

function extractReadPlanProviders(readTargets = {}) {
  const providers = [];
  const github = asObject(readTargets.github);
  const figma = asObject(readTargets.figma);
  if (firstNonEmptyText(github.repository, github.branch) || (Array.isArray(github.file_paths) && github.file_paths.length > 0)) {
    providers.push("github");
  }
  if (firstNonEmptyText(figma.file_key, figma.page_id, figma.frame_id) || (Array.isArray(figma.node_ids) && figma.node_ids.length > 0)) {
    providers.push("figma");
  }
  return providers;
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
  if (criteria.runInternalId) {
    where.push("id=?");
    params.push(criteria.runInternalId);
  }
  return withRetry(() =>
    db
      .prepare(
        `SELECT id, project_id, thread_id, ai_setting_id, status, job_type, run_mode, inputs_json, failure_code, search_provider, created_at, updated_at
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
  if (criteria.runInternalId) {
    where.push("m.run_id=?");
    params.push(criteria.runInternalId);
  }
  return withRetry(() =>
    db
      .prepare(
        `SELECT m.id AS message_id, m.thread_id, m.run_id, m.author, m.role, m.content, m.body, m.created_at, t.project_id
         FROM thread_messages m
         JOIN project_threads t ON t.tenant_id = m.tenant_id AND t.id = m.thread_id
         WHERE ${where.join(" AND ")}
         ORDER BY m.created_at DESC`
      )
      .all(...params)
  );
}

function pushEvent(out, event, criteria) {
  if (!event || !event.event_type || !event.recorded_at) return;
  if (!withinTimeRange(event.recorded_at, criteria.startAt, criteria.endAt)) return;
  if (!matchesFilter(event.event_type, criteria.eventTypes)) return;
  if (!matchesFilter(event.provider, criteria.providers)) return;
  if (!matchesFilter(event.status, criteria.statuses)) return;
  out.push(event);
}

function deriveRunEvents(row, criteria, out) {
  const inputs = parseJsonSafe(row.inputs_json);
  const contextUsed = asObject(inputs.context_used);
  const readPlan = asObject(inputs.external_read_plan);
  const plannedActions = Array.isArray(inputs.planned_actions)
    ? inputs.planned_actions
    : Array.isArray(contextUsed.planned_actions)
      ? contextUsed.planned_actions
      : [];
  const externalOperations = Array.isArray(inputs.external_operations)
    ? inputs.external_operations
    : Array.isArray(contextUsed.external_operations)
      ? contextUsed.external_operations
      : [];
  const runId = toPublicRunId(row.id);
  const projectId = toPublicProjectId(row.project_id);
  const threadId = toPublicThreadId(row.thread_id);
  const actor = buildActor({
    requested_by: firstNonEmptyText(inputs.requested_by),
    ai_setting_id: row.ai_setting_id || inputs.ai_setting_id,
  });
  const runStatus = normalizeRunStatus(row.status);
  const runProvider = firstNonEmptyText(inputs.ai_provider, row.search_provider);
  const relatedIds = buildRelatedIds({ projectId, threadId, runId });
  const externalAudit = buildExternalAuditView({
    runId,
    projectId,
    status: runStatus,
    inputs,
    externalOperations,
    plannedActions,
  });

  pushEvent(
    out,
    {
      event_id: `${runId}:run.created`,
      event_type: "run.created",
      provider: runProvider || null,
      status: runStatus,
      summary: summarizeText(`Run created: ${firstNonEmptyText(row.job_type, row.run_mode, "run")}`),
      actor,
      related_ids: relatedIds,
      recorded_at: row.created_at,
    },
    criteria
  );

  if (row.updated_at && row.updated_at !== row.created_at) {
    const suffix = runStatus === "failed" && asText(row.failure_code) ? ` (${row.failure_code})` : "";
    pushEvent(
      out,
      {
        event_id: `${runId}:run.status_changed`,
        event_type: "run.status_changed",
        provider: runProvider || null,
        status: runStatus,
        summary: summarizeText(`Run status changed to ${runStatus}${suffix}`),
        actor,
        related_ids: relatedIds,
        recorded_at: row.updated_at,
      },
      criteria
    );
  }

  if (Object.keys(readPlan).length > 0) {
    const providers = extractReadPlanProviders(asObject(readPlan.read_targets));
    const eventProviders = providers.length > 0 ? providers : [null];
    eventProviders.forEach((provider, index) => {
      pushEvent(
        out,
        {
          event_id: `${runId}:read.plan_recorded:${provider || "none"}:${index + 1}`,
          event_type: "read.plan_recorded",
          provider,
          status: normalizeOperationStatus(readPlan.actionability || "recorded"),
          summary: summarizeText(
            `Read plan recorded${provider ? `: ${provider}` : ""} ${readPlan.confirm_required ? "(confirm required)" : ""}`
          ),
          actor,
          related_ids: relatedIds,
          recorded_at: firstNonEmptyText(readPlan.recorded_at, row.created_at),
        },
        criteria
      );
    });
  }

  plannedActions.forEach((entry, index) => {
    const planned = asObject(entry);
    const provider = asText(planned.provider) || null;
    const status = normalizeOperationStatus(planned.status || "recorded");
    const actionId = asText(planned.action_id) || null;
    const eventActor = buildActor({
      requested_by: actor.requested_by,
      ai_setting_id: actor.ai_setting_id,
    });
    pushEvent(
      out,
      {
        event_id: `${runId}:write.plan_recorded:${actionId || index + 1}`,
        event_type: "write.plan_recorded",
        provider,
        status,
        summary: summarizeText(
          `Write plan recorded: ${firstNonEmptyText(planned.operation_type, "write")} ${provider ? `(${provider})` : ""}`
        ),
        actor: eventActor,
        related_ids: buildRelatedIds({ projectId, threadId, runId, actionId }),
        recorded_at: firstNonEmptyText(planned.requested_at, row.updated_at, row.created_at),
      },
      criteria
    );
    if (planned.confirmed_at) {
      pushEvent(
        out,
        {
          event_id: `${runId}:confirm.executed:${actionId || index + 1}`,
          event_type: "confirm.executed",
          provider,
          status: normalizeOperationStatus(planned.status || "confirmed"),
          summary: summarizeText(
            `Confirm executed: ${firstNonEmptyText(planned.operation_type, "write")} ${provider ? `(${provider})` : ""}`
          ),
          actor: eventActor,
          related_ids: buildRelatedIds({ projectId, threadId, runId, actionId }),
          recorded_at: planned.confirmed_at,
        },
        criteria
      );
    }
  });

  externalOperations.forEach((entry, index) => {
    const operation = asObject(entry);
    const provider = asText(operation.provider) || null;
    const result = asObject(operation.result);
    const operationType = firstNonEmptyText(operation.operation_type, "external_operation");
    pushEvent(
      out,
      {
        event_id: `${runId}:external_operation.recorded:${index + 1}`,
        event_type: "external_operation.recorded",
        provider,
        status: normalizeOperationStatus(result.status),
        summary: summarizeText(
          `External operation recorded: ${operationType} ${provider ? `(${provider})` : ""} ${result.status ? `[${result.status}]` : ""}`
        ),
        actor,
        related_ids: relatedIds,
        recorded_at: firstNonEmptyText(operation.recorded_at, row.updated_at, row.created_at),
      },
      criteria
    );
  });

  if (Object.keys(externalAudit).length > 0) {
    const auditActor = buildActor(asObject(externalAudit.actor));
    const auditProviders = [];
    const writeActual = Array.isArray(externalAudit.write_actual) ? externalAudit.write_actual : [];
    const writePlan = Array.isArray(externalAudit.write_plan) ? externalAudit.write_plan : [];
    writeActual.forEach((entry) => {
      const provider = asText(entry && entry.provider);
      if (provider && !auditProviders.includes(provider)) auditProviders.push(provider);
    });
    writePlan.forEach((entry) => {
      const provider = asText(entry && entry.provider);
      if (provider && !auditProviders.includes(provider)) auditProviders.push(provider);
    });
    if (auditProviders.length === 0) auditProviders.push(null);
    auditProviders.forEach((provider, index) => {
      pushEvent(
        out,
        {
          event_id: `${runId}:audit.projected:${provider || "none"}:${index + 1}`,
          event_type: "audit.projected",
          provider,
          status: normalizeRunStatus(asText(externalAudit.scope && externalAudit.scope.status) || runStatus),
          summary: summarizeText(`Audit projected${provider ? `: ${provider}` : ""}`),
          actor: auditActor,
          related_ids: relatedIds,
          recorded_at: firstNonEmptyText(
            externalAudit.recorded_at,
            externalAudit.projected_at,
            row.updated_at,
            row.created_at
          ),
        },
        criteria
      );
    });
  }
}

function deriveMessageEvents(row, criteria, out) {
  const projectId = toPublicProjectId(row.project_id);
  const threadId = toPublicThreadId(row.thread_id);
  const runId = toPublicRunId(row.run_id);
  const role = asText(row.role) || (asText(row.author).toLowerCase() === "assistant" ? "assistant" : "user");
  pushEvent(
    out,
    {
      event_id: `${threadId || "thread"}:chat.message_recorded:${row.message_id}`,
      event_type: "chat.message_recorded",
      provider: null,
      status: role,
      summary: summarizeText(firstNonEmptyText(row.content, row.body)),
      actor: buildActor({ requested_by: row.author, role, author: row.author }),
      related_ids: buildRelatedIds({
        projectId,
        threadId,
        runId,
        messageId: asText(row.message_id) || null,
      }),
      recorded_at: row.created_at,
    },
    criteria
  );
}

function sortEvents(events) {
  return events.sort((a, b) => {
    const at = asText(a.recorded_at);
    const bt = asText(b.recorded_at);
    if (at !== bt) return at < bt ? 1 : -1;
    return asText(a.event_id) < asText(b.event_id) ? 1 : -1;
  });
}

function listHistory(db, criteria) {
  const events = [];
  collectRunRows(db, criteria).forEach((row) => deriveRunEvents(row, criteria, events));
  collectMessageRows(db, criteria).forEach((row) => deriveMessageEvents(row, criteria, events));
  return sortEvents(events);
}

function eventDateKey(recordedAt) {
  const text = asText(recordedAt);
  return text ? text.slice(0, 10) : "unknown";
}

function buildDaySummary(group) {
  const parts = [`${group.event_count} events`];
  if (group.run_count > 0) parts.push(`${group.run_count} runs`);
  if (group.confirmed_count > 0) parts.push(`${group.confirmed_count} confirm executed`);
  if (group.failed_count > 0) parts.push(`${group.failed_count} failed`);
  if (group.skipped_count > 0) parts.push(`${group.skipped_count} skipped`);
  return parts.join(", ");
}

function buildRunSummaryText(summary) {
  const parts = [`${summary.event_count} events`];
  if (summary.confirmed_count > 0) parts.push(`${summary.confirmed_count} confirm`);
  if (summary.failed_count > 0) parts.push(`${summary.failed_count} failed`);
  if (summary.skipped_count > 0) parts.push(`${summary.skipped_count} skipped`);
  if (summary.providers.length > 0) parts.push(summary.providers.join("/"));
  return parts.join(", ");
}

function summarizeHistoryPage(items) {
  const rows = Array.isArray(items) ? items : [];
  const dayMap = new Map();
  const runMap = new Map();

  rows.forEach((item) => {
    const dateKey = eventDateKey(item.recorded_at);
    const related = asObject(item.related_ids);
    const runId = asText(related.run_id);
    const status = normalizeStatus(item.status);
    const provider = asText(item.provider);

    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, {
        date: dateKey,
        event_count: 0,
        run_ids: new Set(),
        confirmed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        item_event_ids: [],
      });
    }
    const day = dayMap.get(dateKey);
    day.event_count += 1;
    if (runId) day.run_ids.add(runId);
    if (status === "confirmed") day.confirmed_count += 1;
    if (status === "failed" || status === "error") day.failed_count += 1;
    if (status === "skipped" || status === "confirm_required") day.skipped_count += 1;
    day.item_event_ids.push(item.event_id);

    if (runId) {
      if (!runMap.has(runId)) {
        runMap.set(runId, {
          run_id: runId,
          project_id: asText(related.project_id) || null,
          thread_id: asText(related.thread_id) || null,
          event_count: 0,
          confirmed_count: 0,
          failed_count: 0,
          skipped_count: 0,
          latest_recorded_at: "",
          providers: new Set(),
          event_types: new Set(),
        });
      }
      const summary = runMap.get(runId);
      summary.event_count += 1;
      if (status === "confirmed") summary.confirmed_count += 1;
      if (status === "failed" || status === "error") summary.failed_count += 1;
      if (status === "skipped" || status === "confirm_required") summary.skipped_count += 1;
      if (provider) summary.providers.add(provider);
      if (item.event_type) summary.event_types.add(item.event_type);
      if (!summary.latest_recorded_at || asText(item.recorded_at) > summary.latest_recorded_at) {
        summary.latest_recorded_at = asText(item.recorded_at);
      }
    }
  });

  const day_groups = Array.from(dayMap.values())
    .map((group) => ({
      date: group.date,
      event_count: group.event_count,
      run_count: group.run_ids.size,
      confirmed_count: group.confirmed_count,
      failed_count: group.failed_count,
      skipped_count: group.skipped_count,
      item_event_ids: group.item_event_ids,
      summary: buildDaySummary({ ...group, run_count: group.run_ids.size }),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const run_summaries = Array.from(runMap.values())
    .map((summary) => ({
      run_id: summary.run_id,
      project_id: summary.project_id,
      thread_id: summary.thread_id,
      event_count: summary.event_count,
      confirmed_count: summary.confirmed_count,
      failed_count: summary.failed_count,
      skipped_count: summary.skipped_count,
      latest_recorded_at: summary.latest_recorded_at || null,
      providers: Array.from(summary.providers.values()).sort(),
      event_types: Array.from(summary.event_types.values()).sort(),
      summary: buildRunSummaryText({
        ...summary,
        providers: Array.from(summary.providers.values()).sort(),
      }),
    }))
    .sort((a, b) => {
      if (a.latest_recorded_at !== b.latest_recorded_at) {
        return a.latest_recorded_at < b.latest_recorded_at ? 1 : -1;
      }
      return a.run_id < b.run_id ? 1 : -1;
    });

  return {
    day_groups,
    run_summaries,
  };
}

module.exports = {
  listHistory,
  summarizeHistoryPage,
};
