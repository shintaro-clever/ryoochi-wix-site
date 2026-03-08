const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { parseRunIdInput, getRun, appendRunPlannedAction, appendRunExternalOperation, hashConfirmToken } = require("../../api/runs");
const { buildFigmaWritePlan } = require("../../integrations/figma/writePlan");

async function handleFigmaWritePlan(req, res, db) {
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
  const runIdInput = typeof body.run_id === "string" ? body.run_id.trim() : "";
  if (!runIdInput) {
    return jsonError(res, 400, "VALIDATION_ERROR", "run_id is required", { failure_code: "validation_error" });
  }
  const parsed = parseRunIdInput(runIdInput);
  if (!parsed.ok) {
    return jsonError(
      res,
      parsed.status || 400,
      parsed.code || "VALIDATION_ERROR",
      parsed.message || "run_id format is invalid",
      parsed.details || { failure_code: "validation_error" }
    );
  }
  const run = getRun(db, parsed.internalId);
  if (!run) {
    return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
  }
  const plan = buildFigmaWritePlan({ body, run });
  if (!plan.file_key) {
    return jsonError(res, 400, "VALIDATION_ERROR", "figma_file_key is required", {
      failure_code: "validation_error",
    });
  }
  if (!Array.isArray(plan.changes) || plan.changes.length === 0) {
    return jsonError(res, 400, "VALIDATION_ERROR", "change_type or changes is required", {
      failure_code: "validation_error",
    });
  }

  const confirmToken = crypto.randomBytes(18).toString("hex");
  const planned = appendRunPlannedAction(db, parsed.internalId, {
    action_id: crypto.randomUUID(),
    provider: "figma",
    operation_type: "figma.apply_changes",
    target: {
      file_key: plan.file_key,
      page_id: plan.target.page_id,
      frame_id: plan.target.frame_id,
      node_ids: plan.target.node_ids,
    },
    confirm_token_hash: hashConfirmToken(confirmToken),
    status: "confirm_required",
  });
  if (!planned) {
    return jsonError(res, 500, "VALIDATION_ERROR", "failed to store planned action", {
      failure_code: "service_unavailable",
    });
  }

  appendRunExternalOperation(db, parsed.internalId, {
    provider: "figma",
    operation_type: "figma.write_plan",
    target: {
      file_key: plan.file_key,
      page_id: plan.target.page_id,
      frame_id: plan.target.frame_id,
      node_ids: plan.target.node_ids,
    },
    result: {
      status: "skipped",
      failure_code: null,
      reason: "confirm_required",
    },
    artifacts: {
      figma_file_key: plan.file_key,
      figma_page_id: plan.target.page_id || null,
      figma_frame_id: plan.target.frame_id || null,
      figma_node_ids: Array.isArray(plan.target.node_ids) ? plan.target.node_ids : [],
    },
  });

  return sendJson(res, 201, {
    run_id: runIdInput,
    ...plan,
    planned_action: {
      action_id: planned.action_id,
      provider: planned.provider,
      operation_type: planned.operation_type,
      target: planned.target,
      requested_at: planned.requested_at,
      expires_at: planned.expires_at,
      status: planned.status,
    },
    confirm_token: confirmToken,
  });
}

module.exports = {
  handleFigmaWritePlan,
};
