"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const {
  parseRunIdInput,
  getRun,
  patchRunInputs,
  appendRunExternalOperation,
} = require("../../api/runs");
const { compareExecutionDiff, normalizeExecutionInput } = require("../../fidelity/executionDiff");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readCandidateFromRun(run) {
  const inputs = asObject(run && run.inputs);
  const captureRequest = asObject(inputs.capture_request);
  const fidelityEnvironment = asObject(inputs.fidelity_environment);
  const conditions = asObject(fidelityEnvironment.conditions);
  const fixture = asObject(conditions.fixture_data);
  return normalizeExecutionInput({
    viewport: captureRequest.viewport || conditions.viewport,
    theme: captureRequest.theme || conditions.theme,
    data_state: fixture.dataset_id || fixture.snapshot_id || fixture.mode,
    browser: {
      name: asText(captureRequest.browser_name || "chromium"),
      version: asText(captureRequest.browser_version),
      engine: asText(captureRequest.browser_engine || "blink"),
    },
    font_fallback: Array.isArray(captureRequest.font_fallback)
      ? captureRequest.font_fallback
      : Array.isArray(captureRequest.font_fallbacks)
        ? captureRequest.font_fallbacks
        : [],
    runtime_status: "ok",
    network_contract_status: "ok",
    performance_guardrail_status: "ok",
  });
}

async function handleExecutionDiff(req, res, db) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }

  const runIdInput = asText(body.run_id);
  if (!runIdInput) {
    return jsonError(res, 400, "VALIDATION_ERROR", "run_id is required", { failure_code: "validation_error" });
  }
  const parsedRunId = parseRunIdInput(runIdInput);
  if (!parsedRunId.ok) {
    return jsonError(
      res,
      parsedRunId.status || 400,
      parsedRunId.code || "VALIDATION_ERROR",
      parsedRunId.message || "run_id format is invalid",
      parsedRunId.details || { failure_code: "validation_error" }
    );
  }
  const run = getRun(db, parsedRunId.internalId);
  if (!run) {
    return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
  }

  const baselineExecution = normalizeExecutionInput(body.baseline_execution || run.inputs?.execution_baseline || {});
  const candidateExecution = normalizeExecutionInput(body.candidate_execution || readCandidateFromRun(run));
  const thresholdRaw = Number(body.threshold);
  const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 95;
  const executionDiff = compareExecutionDiff(baselineExecution, candidateExecution, { threshold });

  const patchOk = patchRunInputs(db, parsedRunId.internalId, {
    execution_diff: executionDiff,
    context_used: {
      execution_diff: executionDiff,
    },
  });
  if (!patchOk) {
    return jsonError(res, 500, "SERVICE_UNAVAILABLE", "run update failed", {
      failure_code: "service_unavailable",
    });
  }

  const failureCode = executionDiff.pass
    ? null
    : executionDiff.environment_only_mismatch
      ? "execution_diff_environment_only_mismatch"
      : "execution_diff_below_threshold";

  appendRunExternalOperation(db, parsedRunId.internalId, {
    provider: "fidelity",
    operation_type: "fidelity.execution_diff",
    target: {
      path: ".ai-runs",
    },
    result: {
      status: executionDiff.pass ? "ok" : "error",
      failure_code: failureCode,
      reason: failureCode,
    },
    artifacts: {
      fidelity_score: executionDiff.score,
      fidelity_status: executionDiff.pass ? "passed" : "failed",
      environment_only_mismatch: executionDiff.environment_only_mismatch,
    },
  });

  return sendJson(res, 200, {
    run_id: runIdInput,
    execution_diff: executionDiff,
    status: executionDiff.pass ? "ok" : "error",
    failure_code: failureCode,
  });
}

module.exports = {
  handleExecutionDiff,
};
