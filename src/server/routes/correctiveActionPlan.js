"use strict";

const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const {
  parseRunIdInput,
  getRun,
  patchRunInputs,
  appendRunExternalOperation,
} = require("../../api/runs");
const { buildCorrectiveActionPlan } = require("../../fidelity/correctiveActionPlan");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function handleCorrectiveActionPlan(req, res, db) {
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
  let run = null;
  let parsedRunId = null;
  if (runIdInput) {
    parsedRunId = parseRunIdInput(runIdInput);
    if (!parsedRunId.ok) {
      return jsonError(
        res,
        parsedRunId.status || 400,
        parsedRunId.code || "VALIDATION_ERROR",
        parsedRunId.message || "run_id format is invalid",
        parsedRunId.details || { failure_code: "validation_error" }
      );
    }
    run = getRun(db, parsedRunId.internalId);
    if (!run) {
      return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
    }
  }

  const payload = {
    ...asObject(run && run.inputs),
    ...asObject(body),
  };
  const correctiveActionPlan = buildCorrectiveActionPlan(payload, {
    max_actions: body.max_actions,
  });

  if (parsedRunId && run) {
    const patchOk = patchRunInputs(db, parsedRunId.internalId, {
      corrective_action_plan: correctiveActionPlan,
      context_used: {
        corrective_action_plan: correctiveActionPlan,
      },
    });
    if (!patchOk) {
      return jsonError(res, 500, "SERVICE_UNAVAILABLE", "run update failed", {
        failure_code: "service_unavailable",
      });
    }

    appendRunExternalOperation(db, parsedRunId.internalId, {
      provider: "fidelity",
      operation_type: "fidelity.corrective_action_plan",
      target: {
        path: ".ai-runs",
      },
      result: {
        status: correctiveActionPlan.status === "ok" ? "ok" : "error",
        failure_code: correctiveActionPlan.status === "ok" ? null : "corrective_action_plan_generation_failed",
        reason: correctiveActionPlan.status === "ok" ? null : "corrective_action_plan_generation_failed",
      },
      artifacts: {
        action_count: correctiveActionPlan.summary.total_actions,
        reason_count: correctiveActionPlan.summary.total_reasons,
      },
    });
  }

  return sendJson(res, 200, {
    run_id: runIdInput || null,
    corrective_action_plan: correctiveActionPlan,
    status: correctiveActionPlan.status,
    failure_code: correctiveActionPlan.status === "ok" ? null : "corrective_action_plan_generation_failed",
  });
}

module.exports = {
  handleCorrectiveActionPlan,
};
