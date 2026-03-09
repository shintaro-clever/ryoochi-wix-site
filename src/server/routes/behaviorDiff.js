"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const {
  parseRunIdInput,
  getRun,
  patchRunInputs,
  appendRunExternalOperation,
} = require("../../api/runs");
const { compareBehaviorDiff, REQUIRED_STATES } = require("../../fidelity/behaviorDiff");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function handleBehaviorDiff(req, res, db) {
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
  const captureResult =
    run.inputs &&
    run.inputs.capture_result &&
    typeof run.inputs.capture_result === "object"
      ? run.inputs.capture_result
      : {};
  const baselineStates = Array.isArray(body.baseline_states)
    ? body.baseline_states
    : Array.isArray(run.inputs?.behavior_baseline_states)
      ? run.inputs.behavior_baseline_states
      : [];
  const candidateStates = Array.isArray(body.candidate_states)
    ? body.candidate_states
    : Array.isArray(captureResult.state_results)
      ? captureResult.state_results
      : [];
  const thresholdRaw = Number(body.threshold);
  const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 95;
  const requiredStates = Array.isArray(body.required_states) && body.required_states.length > 0
    ? body.required_states
    : REQUIRED_STATES;
  const behaviorDiff = compareBehaviorDiff(baselineStates, candidateStates, {
    threshold,
    requiredStates,
  });

  const patchOk = patchRunInputs(db, parsedRunId.internalId, {
    behavior_diff: behaviorDiff,
    context_used: {
      behavior_diff: behaviorDiff,
    },
  });
  if (!patchOk) {
    return jsonError(res, 500, "SERVICE_UNAVAILABLE", "run update failed", {
      failure_code: "service_unavailable",
    });
  }

  appendRunExternalOperation(db, parsedRunId.internalId, {
    provider: "fidelity",
    operation_type: "fidelity.behavior_diff",
    target: {
      path: ".ai-runs",
    },
    result: {
      status: behaviorDiff.pass ? "ok" : "error",
      failure_code: behaviorDiff.pass ? null : "behavior_diff_below_threshold",
      reason: behaviorDiff.pass ? null : "behavior_diff_below_threshold",
    },
    artifacts: {
      fidelity_score: behaviorDiff.score,
      fidelity_status: behaviorDiff.pass ? "passed" : "failed",
    },
  });

  return sendJson(res, 200, {
    run_id: runIdInput,
    behavior_diff: behaviorDiff,
    status: behaviorDiff.pass ? "ok" : "error",
    failure_code: behaviorDiff.pass ? null : "behavior_diff_below_threshold",
  });
}

module.exports = {
  handleBehaviorDiff,
};
