"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { getRun, createRun, parseRunIdInput, toPublicRunId } = require("../../api/runs");

const ALLOWED_RETRY_KINDS = new Set(["read_only", "failed_run"]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value == null ? {} : value));
}

function validationDetails(reason, extra = {}) {
  return { failure_code: "validation_error", reason, ...extra };
}

function stripWriteExecutionFields(rawWrite) {
  const source = asObject(rawWrite);
  const next = { ...source };
  delete next.confirm;
  delete next.execute;
  delete next.auto_execute;
  delete next.confirm_token;
  delete next.planned_action_id;
  delete next.action_id;
  return next;
}

function sanitizeRetryInputs(run, retryKind, actorId) {
  const sourceInputs = cloneJson(run && run.inputs ? run.inputs : {});
  const contextUsed = asObject(sourceInputs.context_used);
  const originalWrite = asObject(sourceInputs.write);
  const hadWritePayload = Object.keys(originalWrite).length > 0;
  const hadConfirmRequiredWrite =
    Array.isArray(run && run.planned_actions) &&
    run.planned_actions.some((entry) => entry && String(entry.status || "").toLowerCase() === "confirm_required");

  delete sourceInputs.external_operations;
  delete sourceInputs.planned_actions;
  delete sourceInputs.fidelity_reasons;
  delete sourceInputs.fidelity_evidence;
  delete sourceInputs.corrective_action_plan;
  delete sourceInputs.capture_result;
  delete sourceInputs.structure_diff;
  delete sourceInputs.visual_diff;
  delete sourceInputs.behavior_diff;
  delete sourceInputs.execution_diff;
  delete sourceInputs.phase4_score;
  delete sourceInputs.phase4_fidelity_score;
  delete sourceInputs.fg_validation;

  sourceInputs.write = stripWriteExecutionFields(sourceInputs.write);
  sourceInputs.context_used = {
    ...contextUsed,
    external_operations: [],
    planned_actions: [],
    fidelity_reasons: null,
    fidelity_evidence: null,
    corrective_action_plan: null,
    capture_result: null,
    behavior_diff: null,
    execution_diff: null,
  };
  sourceInputs.retry_of_run_id = run.run_id;
  sourceInputs.retry_kind = retryKind;
  sourceInputs.retry_requested_at = new Date().toISOString();
  sourceInputs.retry = {
    source_run_id: run.run_id,
    retry_kind: retryKind,
    requested_by: actorId || "user",
    requested_at: sourceInputs.retry_requested_at,
    source_status: run.status || null,
  };
  sourceInputs.requested_by = actorId || sourceInputs.requested_by || "user";
  if (retryKind === "read_only") {
    delete sourceInputs.write;
  }

  return {
    inputs: sourceInputs,
    safety: {
      had_write_payload: hadWritePayload,
      confirm_required_write_stripped: retryKind === "read_only" ? hadWritePayload || hadConfirmRequiredWrite : hadConfirmRequiredWrite,
      write_execution_replayed: false,
    },
  };
}

async function handleRunRetry(req, res, db, { onRunQueued } = {}) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }

  const match = (req.url || "").match(/^\/api\/runs\/([^/]+)\/retry(?:\?.*)?$/);
  if (!match) {
    return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", validationDetails("invalid_json"));
  }

  const parsedRunId = parseRunIdInput(match[1]);
  if (!parsedRunId.ok) {
    return jsonError(res, parsedRunId.status, parsedRunId.code, parsedRunId.message, parsedRunId.details);
  }
  const sourceRun = getRun(db, parsedRunId.internalId);
  if (!sourceRun) {
    return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
  }

  const retryKind = asText(body.retry_kind || body.mode).toLowerCase();
  if (!ALLOWED_RETRY_KINDS.has(retryKind)) {
    return jsonError(res, 400, "VALIDATION_ERROR", "retry_kind is invalid", validationDetails("invalid_retry_kind"));
  }
  if (retryKind === "failed_run" && String(sourceRun.status || "").toLowerCase() !== "failed") {
    return jsonError(res, 409, "CONFLICT", "failed_run retry requires failed source run", validationDetails("source_run_not_failed"));
  }

  const actorId = asText(req.user && req.user.id) || "user";
  const retryPayload = sanitizeRetryInputs(sourceRun, retryKind, actorId);
  const newRunId = createRun(db, {
    project_id: sourceRun.project_id,
    thread_id: sourceRun.thread_id,
    ai_setting_id: sourceRun.ai_setting_id,
    job_type: sourceRun.job_type,
    run_mode: sourceRun.run_mode || "mcp",
    inputs: retryPayload.inputs,
    target_path: sourceRun.target_path,
    figma_file_key: sourceRun.figma_file_key,
    ingest_artifact_path: sourceRun.ingest_artifact_path,
  });
  if (typeof onRunQueued === "function") {
    onRunQueued(newRunId);
  }

  return sendJson(res, 201, {
    source_run_id: sourceRun.run_id,
    retry_run_id: toPublicRunId(newRunId),
    retry_kind: retryKind,
    status: "queued",
    safety: retryPayload.safety,
  });
}

module.exports = {
  handleRunRetry,
};
