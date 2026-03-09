"use strict";

const { PassThrough } = require("stream");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { parseRunIdInput, getRun, appendRunExternalOperation } = require("../../api/runs");
const { validateCorrectiveActionConnection } = require("../../fidelity/correctiveActionConnect");
const { handleGithubWritePlan } = require("./githubWritePlan");
const { handleFigmaWritePlan } = require("./figmaWritePlan");

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requestLocalHandler(handler, payload, db) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/internal/fidelity-corrective-action";
    req.headers = { "content-type": "application/json" };
    req.setEncoding = () => {};
    req.on("error", reject);

    const res = new PassThrough();
    const headers = {};
    let statusCode = 200;
    res.setHeader = (key, value) => {
      headers[String(key).toLowerCase()] = value;
    };
    res.writeHead = (code, nextHeaders = {}) => {
      statusCode = code;
      Object.entries(nextHeaders).forEach(([key, value]) => {
        headers[String(key).toLowerCase()] = value;
      });
    };
    const chunks = [];
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) res.write(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      resolve({ statusCode, headers, body, parsed });
      return true;
    };
    res.on("error", reject);

    Promise.resolve(handler(req, res, db)).catch(reject);
    process.nextTick(() => {
      req.write(JSON.stringify(payload || {}));
      req.end();
    });
  });
}

function buildDelegatedPayload(body, provider) {
  const write = asObject(body.write);
  return {
    run_id: body.run_id,
    ...write,
    provider,
  };
}

async function handleCorrectiveActionWritePlan(req, res, db) {
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

  if (body && (body.confirm === true || body.execute === true || body.auto_execute === true)) {
    return jsonError(res, 400, "VALIDATION_ERROR", "corrective action connection only creates confirm-required plans", {
      failure_code: "validation_error",
      reason: "auto_execution_forbidden",
    });
  }

  const parsedRunId = parseRunIdInput(body.run_id);
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

  const validation = validateCorrectiveActionConnection(
    run.inputs || {},
    { action_key: body.action_key, category: body.category },
    body.provider
  );
  if (!validation.ok) {
    return jsonError(res, 400, "VALIDATION_ERROR", validation.message, {
      failure_code: validation.failure_code,
      reason: validation.reason,
      corrective_action_plan: validation.plan,
      corrective_action: validation.action,
    });
  }

  const write = asObject(body.write);
  if (Object.keys(write).length === 0) {
    return jsonError(res, 400, "VALIDATION_ERROR", "write payload is required", {
      failure_code: "validation_error",
      reason: "write_payload_required",
      corrective_action: validation.action,
    });
  }

  const delegatedPayload = buildDelegatedPayload(body, validation.provider);
  const delegated =
    validation.provider === "github"
      ? await requestLocalHandler(handleGithubWritePlan, delegatedPayload, db)
      : await requestLocalHandler(handleFigmaWritePlan, delegatedPayload, db);

  if (delegated.statusCode < 200 || delegated.statusCode >= 300) {
    return sendJson(res, delegated.statusCode || 400, delegated.parsed || {
      error: "write plan failed",
      details: {
        failure_code: "validation_error",
      },
    });
  }

  appendRunExternalOperation(db, parsedRunId.internalId, {
    provider: "fidelity",
    operation_type: "fidelity.corrective_action_write_plan",
    target: {
      path: ".ai-runs",
      paths: validation.action.suggested_target_paths,
    },
    result: {
      status: "ok",
      failure_code: null,
      reason: "confirm_required",
    },
    artifacts: {
      provider: validation.provider,
      action_key: validation.action.key,
      action_category: validation.action.category,
      planned_action_id:
        delegated.parsed &&
        delegated.parsed.planned_action &&
        typeof delegated.parsed.planned_action.action_id === "string"
          ? delegated.parsed.planned_action.action_id
          : null,
    },
  });

  return sendJson(res, 201, {
    run_id: body.run_id,
    provider: validation.provider,
    confirm_required: true,
    confirm_required_reason: "corrective_action_confirmation_required",
    corrective_action: validation.action,
    write_plan: delegated.parsed,
  });
}

module.exports = {
  handleCorrectiveActionWritePlan,
};
