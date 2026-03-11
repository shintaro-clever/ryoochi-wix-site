"use strict";

const { PassThrough } = require("stream");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { parseRunIdInput, getRun, appendRunExternalOperation } = require("../../api/runs");
const { validateCorrectiveActionConnection } = require("../../fidelity/correctiveActionConnect");
const { handleGithubWritePlan } = require("./githubWritePlan");
const { handleFigmaWritePlan } = require("./figmaWritePlan");
const { createWritePlan } = require("../../db/writePlans");
const { toWritePlanApi } = require("../writePlans");

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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSourceRef(body, action, provider) {
  const writePlanSource = asObject(body.write_plan_source);
  const sourceRef = asObject(writePlanSource.source_ref);
  return {
    system: sourceRef.system || "hub",
    ref_kind: sourceRef.ref_kind || "corrective_action",
    ref_id: sourceRef.ref_id || normalizeText(action && action.key) || null,
    path: sourceRef.path || null,
    label: sourceRef.label || normalizeText(action && action.title) || "corrective action write plan",
    version: sourceRef.version || null,
    metadata: {
      ...asObject(sourceRef.metadata),
      provider,
      category: normalizeText(action && action.category) || null,
      entrypoint: normalizeText(writePlanSource.entrypoint) || "run_detail",
    },
  };
}

function buildTargetRefs(provider, delegatedPlan) {
  if (provider === "github") {
    const repository = normalizeText(delegatedPlan && delegatedPlan.repository);
    const branch = normalizeText(delegatedPlan && delegatedPlan.target_branch);
    const refs = [];
    if (repository) {
      refs.push({
        system: "github",
        target_type: "repo",
        id: repository,
        path: null,
        name: repository,
        scope: null,
        writable: true,
        metadata: {
          repository,
        },
      });
    }
    if (branch) {
      refs.push({
        system: "github",
        target_type: "branch",
        id: branch,
        path: null,
        name: branch,
        scope: repository || null,
        writable: true,
        metadata: {
          repository: repository || null,
          target_branch: branch,
        },
      });
    }
    safeArray(delegatedPlan && delegatedPlan.write_paths).forEach((item) => {
      refs.push({
        system: "github",
        target_type: "file",
        id: null,
        path: normalizeText(item),
        name: normalizeText(item).split("/").pop() || normalizeText(item),
        scope: repository || null,
        writable: true,
        metadata: {
          repository: repository || null,
          target_branch: branch || null,
        },
      });
    });
    return refs.filter((item) => item.id || item.path || item.name);
  }
  const target = asObject(delegatedPlan && delegatedPlan.target);
  const refs = [];
  if (normalizeText(target.page_id) || normalizeText(target.page_name)) {
    refs.push({
      system: "figma",
      target_type: "page",
      id: normalizeText(target.page_id) || null,
      path: null,
      name: normalizeText(target.page_name) || normalizeText(target.page_id) || "page",
      scope: normalizeText(delegatedPlan && delegatedPlan.file_key) || null,
      writable: true,
      metadata: {
        file_key: normalizeText(delegatedPlan && delegatedPlan.file_key) || null,
      },
    });
  }
  if (normalizeText(target.frame_id) || normalizeText(target.frame_name)) {
    refs.push({
      system: "figma",
      target_type: "frame",
      id: normalizeText(target.frame_id) || null,
      path: null,
      name: normalizeText(target.frame_name) || normalizeText(target.frame_id) || "frame",
      scope: normalizeText(target.page_id || target.page_name) || null,
      writable: true,
      metadata: {
        file_key: normalizeText(delegatedPlan && delegatedPlan.file_key) || null,
        page_id: normalizeText(target.page_id) || null,
      },
    });
  }
  if (normalizeText(target.component_id) || normalizeText(target.component_name) || normalizeText(target.component_key)) {
    refs.push({
      system: "figma",
      target_type: "component",
      id: normalizeText(target.component_id) || normalizeText(target.component_key) || null,
      path: null,
      name: normalizeText(target.component_name) || normalizeText(target.component_id) || normalizeText(target.component_key) || "component",
      scope: normalizeText(target.frame_id || target.page_id) || null,
      writable: true,
      metadata: {
        file_key: normalizeText(delegatedPlan && delegatedPlan.file_key) || null,
        component_key: normalizeText(target.component_key) || null,
        component_set_id: normalizeText(target.component_set_id) || null,
        component_set_name: normalizeText(target.component_set_name) || null,
      },
    });
  }
  safeArray(target.node_ids).forEach((item) => {
    refs.push({
      system: "figma",
      target_type: "node",
      id: normalizeText(item) || null,
      path: null,
      name: normalizeText(item) || "node",
    scope: normalizeText(target.frame_id || target.page_id) || null,
    writable: true,
    metadata: {
      file_key: normalizeText(delegatedPlan && delegatedPlan.file_key) || null,
        page_id: normalizeText(target.page_id) || null,
        frame_id: normalizeText(target.frame_id) || null,
      },
    });
  });
  return refs.filter((item) => item.id || item.name);
}

function buildExpectedChanges(provider, delegatedPlan, targetRefs) {
  const refsByPath = new Map(targetRefs.filter((item) => item.path).map((item) => [item.path, item]));
  const refsById = new Map(targetRefs.filter((item) => item.id).map((item) => [item.id, item]));
  return safeArray(delegatedPlan && delegatedPlan.changes).map((change) => {
    const item = asObject(change);
    const targetRef = provider === "github"
      ? refsByPath.get(normalizeText(item.path)) || {}
      : refsById.get(normalizeText(item.node_id)) || {};
    return {
      change_type: normalizeText(item.change_type) || "update",
      target_ref: targetRef,
      summary:
        normalizeText(item.summary) ||
        normalizeText(item.diff_summary && item.diff_summary.summary) ||
        normalizeText(item.node_id) ||
        normalizeText(item.path) ||
        null,
      before_ref: {},
      after_ref: {},
      patch_hint: normalizeText(item.path || item.node_id) || null,
    };
  }).filter((item) => item.change_type || item.summary);
}

function buildEvidenceRefs(run, action, provider) {
  return {
    run_artifacts: [
      {
        system: "hub",
        ref_kind: "run",
        ref_id: normalizeText(run && run.run_id),
        path: null,
        label: "source run",
        version: null,
        metadata: {
          project_id: normalizeText(run && run.project_id) || null,
          provider,
        },
      },
    ],
    compare_results: [],
    ai_summaries: [],
    source_documents: [
      {
        system: "repo",
        ref_kind: "doc",
        ref_id: "execution-plan-model",
        path: "docs/ai/core/execution-plan-model.md",
        label: "Execution Plan Model",
        version: null,
        metadata: {},
      },
    ],
    other_refs: safeArray(action && action.reason_types).map((item) => ({
      system: "hub",
      ref_kind: "reason_type",
      ref_id: normalizeText(item),
      path: null,
      label: normalizeText(item),
      version: null,
      metadata: {},
    })).filter((item) => item.ref_id),
  };
}

function createCommonWritePlanRecord({ db, run, body, action, provider, delegatedPlan, actorId }) {
  const targetRefs = buildTargetRefs(provider, delegatedPlan);
  return createWritePlan({
    payload: {
      project_id: run.project_id,
      thread_id: run.thread_id || null,
      run_id: run.run_id,
      source_type: "phase4_corrective_action",
      source_ref: toSourceRef(body, action, provider),
      target_kind: provider,
      target_refs: targetRefs,
      summary: normalizeText(action && action.recommendation) || normalizeText(action && action.title) || `${provider} write plan`,
      expected_changes: buildExpectedChanges(provider, delegatedPlan, targetRefs),
      evidence_refs: buildEvidenceRefs(run, action, provider),
      confirm_required: true,
      status: "ready",
      created_by: actorId || "user",
      internal_meta: {
        corrective_action_key: normalizeText(action && action.key) || null,
        corrective_action_category: normalizeText(action && action.category) || null,
      },
    },
    dbConn: db,
  });
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
  const actorId = typeof req.user?.id === "string" && req.user.id.trim() ? req.user.id.trim() : "user";

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

  const writePlanRecord = createCommonWritePlanRecord({
    db,
    run,
    body,
    action: validation.action,
    provider: validation.provider,
    delegatedPlan: delegated.parsed || {},
    actorId,
  });

  return sendJson(res, 201, {
    run_id: body.run_id,
    provider: validation.provider,
    confirm_required: true,
    confirm_required_reason: "corrective_action_confirmation_required",
    corrective_action: validation.action,
    write_plan: delegated.parsed,
    write_plan_record: toWritePlanApi(writePlanRecord),
  });
}

module.exports = {
  handleCorrectiveActionWritePlan,
};
