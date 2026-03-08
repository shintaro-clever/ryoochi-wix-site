const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { parseRunIdInput, getRun, appendRunPlannedAction, appendRunExternalOperation, hashConfirmToken } = require("../../api/runs");
const { buildGithubWritePlan } = require("../../integrations/github/writePlan");

async function handleGithubWritePlan(req, res, db) {
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
  const plan = buildGithubWritePlan({ body, run });
  if (!Array.isArray(plan.changes) || plan.changes.length === 0) {
    return jsonError(res, 400, "VALIDATION_ERROR", "changes or file_path is required", {
      failure_code: "validation_error",
    });
  }

  const confirmToken = crypto.randomBytes(18).toString("hex");
  const planned = appendRunPlannedAction(db, parsed.internalId, {
    action_id: crypto.randomUUID(),
    provider: "github",
    operation_type: "github.create_pr",
    target: {
      repository: plan.repository,
      branch: plan.target_branch,
      path: plan.write_paths[0] || "",
      node_ids: [],
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
    provider: "github",
    operation_type: "github.write_plan",
    target: {
      repository: plan.repository,
      branch: plan.target_branch,
      paths: plan.write_paths,
    },
    result: {
      status: "skipped",
      failure_code: null,
      reason: "confirm_required",
    },
    artifacts: {
      branch: plan.target_branch,
      paths: [],
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
  handleGithubWritePlan,
};
