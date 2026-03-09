"use strict";

const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const {
  parseRunIdInput,
  getRun,
  patchRunInputs,
  appendRunExternalOperation,
} = require("../../api/runs");
const { captureScreenshot } = require("../../capture/screenshot");
const { captureStates } = require("../../capture/stateCapture");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildCaptureRequest({ body = {}, run = {} } = {}) {
  const inputs = asObject(run.inputs);
  const fidelity = asObject(inputs.fidelity_environment);
  const targetEnvironment =
    asText(body.target_environment) ||
    asText(fidelity.target_environment) ||
    "staging";
  const environments = asObject(fidelity.environments);
  const selectedEnv = asObject(environments[targetEnvironment]);
  const conditions = asObject(fidelity.conditions);
  const viewportFromBody = asObject(body.viewport);
  const viewportFromFidelity = asObject(conditions.viewport);
  const url =
    asText(body.target_url) ||
    asText(body.url) ||
    asText(selectedEnv.url);
  const viewport = {
    width: viewportFromBody.width !== undefined ? viewportFromBody.width : viewportFromFidelity.width,
    height: viewportFromBody.height !== undefined ? viewportFromBody.height : viewportFromFidelity.height,
  };
  const theme = asText(body.theme) || asText(conditions.theme) || asText(selectedEnv.theme) || "light";
  const authByEnv = asObject(conditions.auth_state);
  const fixtureData = asObject(conditions.fixture_data);
  return {
    target_environment: targetEnvironment,
    target_url: url,
    viewport,
    theme,
    auth_state: asText(body.auth_state) || asText(authByEnv[targetEnvironment]) || asText(selectedEnv.auth_state) || "anonymous",
    fixture_data: {
      mode: asText(body.fixture_mode) || asText(fixtureData.mode) || "seeded",
      dataset_id: asText(body.fixture_dataset_id) || asText(fixtureData.dataset_id) || "baseline",
      snapshot_id: asText(body.fixture_snapshot_id) || asText(fixtureData.snapshot_id) || "latest",
      seed: asText(body.fixture_seed) || asText(fixtureData.seed) || "default",
      flags:
        body.fixture_flags && typeof body.fixture_flags === "object" && !Array.isArray(body.fixture_flags)
          ? body.fixture_flags
          : fixtureData.flags && typeof fixtureData.flags === "object" && !Array.isArray(fixtureData.flags)
            ? fixtureData.flags
            : {},
    },
  };
}

function buildCaptureRelativePath(internalRunId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `.ai-runs/${internalRunId}/captures/${stamp}-${suffix}.png`;
}

async function handleCaptureScreenshot(req, res, db) {
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

  const captureRequest = buildCaptureRequest({ body, run });
  const outputPath = buildCaptureRelativePath(parsedRunId.internalId);
  const states = Array.isArray(body.states) ? body.states : [];

  const patchOk = patchRunInputs(db, parsedRunId.internalId, {
    capture_request: {
      ...captureRequest,
      output_path: outputPath,
      requested_at: new Date().toISOString(),
    },
    context_used: {
      capture_request: {
        ...captureRequest,
        output_path: outputPath,
        requested_at: new Date().toISOString(),
      },
    },
  });
  if (!patchOk) {
    return jsonError(res, 500, "SERVICE_UNAVAILABLE", "run update failed", {
      failure_code: "service_unavailable",
    });
  }

  try {
    let result;
    let stateCaptureResult = null;
    if (states.length > 0) {
      stateCaptureResult = await captureStates({
        targetUrl: captureRequest.target_url,
        viewport: captureRequest.viewport,
        baseOutputPath: outputPath,
        states,
        timeoutMs: 20000,
      });
      result = {
        mode: stateCaptureResult.success ? "state_capture" : "state_capture_partial",
      };
      if (!stateCaptureResult.success) {
        throw Object.assign(new Error("state capture failed"), {
          failure_code: "capture_failed",
          reason: "state_capture_failed",
          state_results: stateCaptureResult.results,
        });
      }
    } else {
      result = await captureScreenshot({
        targetUrl: captureRequest.target_url,
        viewport: captureRequest.viewport,
        outputPath,
        timeoutMs: 20000,
      });
    }
    patchRunInputs(db, parsedRunId.internalId, {
      capture_result: {
        status: "ok",
        failure_code: null,
        mode: result.mode,
        output_path: outputPath,
        state_results: stateCaptureResult ? stateCaptureResult.results : [],
        captured_at: new Date().toISOString(),
      },
      context_used: {
        capture_result: {
          status: "ok",
          failure_code: null,
          mode: result.mode,
          output_path: outputPath,
          state_results: stateCaptureResult ? stateCaptureResult.results : [],
          captured_at: new Date().toISOString(),
        },
      },
    });
    appendRunExternalOperation(db, parsedRunId.internalId, {
      provider: "capture",
      operation_type: "capture.screenshot",
      target: {
        path: outputPath,
      },
      result: {
        status: "ok",
        failure_code: null,
        reason: null,
      },
      artifacts: {
        paths: stateCaptureResult
          ? stateCaptureResult.results
              .filter((row) => row.status === "ok" && row.artifact_path)
              .map((row) => row.artifact_path)
          : [outputPath],
      },
    });
    return sendJson(res, 201, {
      run_id: runIdInput,
      status: "ok",
      failure_code: null,
      artifact_path: outputPath,
      state_results: stateCaptureResult ? stateCaptureResult.results : [],
      capture_request: captureRequest,
    });
  } catch (error) {
    const failedStateResults = Array.isArray(error && error.state_results) ? error.state_results : [];
    patchRunInputs(db, parsedRunId.internalId, {
      capture_result: {
        status: "error",
        failure_code: "capture_failed",
        reason: error && error.reason ? String(error.reason) : "capture_execution_failed",
        message: error && error.message ? String(error.message) : "capture failed",
        state_results: failedStateResults,
        failed_at: new Date().toISOString(),
      },
      context_used: {
        capture_result: {
          status: "error",
          failure_code: "capture_failed",
          reason: error && error.reason ? String(error.reason) : "capture_execution_failed",
          message: error && error.message ? String(error.message) : "capture failed",
          state_results: failedStateResults,
          failed_at: new Date().toISOString(),
        },
      },
    });
    appendRunExternalOperation(db, parsedRunId.internalId, {
      provider: "capture",
      operation_type: "capture.screenshot",
      target: {
        path: outputPath,
      },
      result: {
        status: "error",
        failure_code: "capture_failed",
        reason: error && error.reason ? String(error.reason) : "capture_execution_failed",
      },
      artifacts: {
        paths: [],
      },
    });
    return jsonError(res, 502, "SERVICE_UNAVAILABLE", error && error.message ? error.message : "capture failed", {
      failure_code: "capture_failed",
      reason: error && error.reason ? String(error.reason) : "capture_execution_failed",
    });
  }
}

module.exports = {
  handleCaptureScreenshot,
};
