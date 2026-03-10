const { PassThrough } = require("stream");
const { DEFAULT_TENANT } = require("../../db");
const { sendJson, jsonError, readJsonBody } = require("../../api/projects");
const { parseRunIdInput, getRun } = require("../../api/runs");
const { getPersonalAiSetting, getDefaultPersonalAiSetting } = require("../personalAiSettingsStore");
const { resolveSecretReference } = require("../openaiConnection");
const { resolveCorrectiveAction } = require("../../fidelity/correctiveActionConnect");
const { generateCorrectiveActionAssist } = require("../../ai/correctiveActionAssist");
const { getProjectSettings } = require("../projectBindingsStore");
const { handleCorrectiveActionWritePlan } = require("./correctiveActionWritePlan");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function requestLocalHandler(handler, payload, db) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/internal/ai-action-assist-write-plan";
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

function firstPathCandidate(values) {
  const list = asArray(values);
  for (const value of list) {
    const text = normalizeText(value);
    if (!text) continue;
    if (/[*]/.test(text)) continue;
    if (/[\\/][^\\/]+\.[A-Za-z0-9]+$/.test(text) || /^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(text)) {
      return text.replace(/^\/+/, "");
    }
  }
  return "";
}

function firstNodeId(run) {
  const inputs = asObject(run && run.inputs);
  const figmaContext = asObject(inputs.connection_context && inputs.connection_context.figma);
  const target = asObject(figmaContext.target);
  const compare = asObject(inputs.figma_after);
  const compareTarget = asObject(compare.target);
  const candidates = [
    ...asArray(target.node_ids),
    ...asArray(compareTarget.node_ids),
  ].map((item) => normalizeText(item)).filter(Boolean);
  return candidates[0] || "";
}

function buildGithubAssistWritePayload({ run, projectSettings, action, assist }) {
  const safeActionKey = normalizeText(action && action.key).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "corrective-action";
  const defaultPath = normalizeText(projectSettings && projectSettings.github_default_path);
  const targetPath =
    firstPathCandidate(assist && assist.target_file_or_component) ||
    firstPathCandidate(action && action.suggested_target_paths) ||
    (defaultPath ? `${defaultPath.replace(/\/+$/g, "")}/corrective-actions/${safeActionKey}.md` : `docs/ai/corrective-actions/${safeActionKey}.md`);
  const expectedImpact = asArray(assist && assist.expected_impact).map((item) => `- ${normalizeText(item)}`).filter(Boolean).join("\n");
  const linkedReasonTypes = asArray(assist && assist.linked_reason_types).map((item) => `- ${normalizeText(item)}`).filter(Boolean).join("\n");
  return {
    run_id: run.run_id,
    category: action.category,
    action_key: action.key,
    provider: "github",
    write: {
      owner: "",
      repo: "",
      head_branch: `assist/${safeActionKey}`,
      file_path: targetPath,
      file_content: [
        "# Corrective Action Draft",
        "",
        `- action_key: ${normalizeText(action.key)}`,
        `- category: ${normalizeText(action.category)}`,
        `- title: ${normalizeText(action.title)}`,
        "",
        "## Recommendation",
        normalizeText(action.recommendation) || "-",
        "",
        "## Expected Impact",
        expectedImpact || "-",
        "",
        "## Linked Reason Types",
        linkedReasonTypes || "-",
      ].join("\n"),
    },
  };
}

function mapFigmaChangeType(category) {
  const text = normalizeText(category);
  if (text === "layout_fix") return "layout_update";
  if (text === "token_fix") return "simple_property_update";
  if (text === "component_swap") return "update";
  return "update";
}

function buildFigmaAssistWritePayload({ run, projectSettings, action, assist }) {
  const nodeId = firstNodeId(run);
  const changeSummary = normalizeText(asArray(assist && assist.expected_impact)[0]) || normalizeText(action && action.recommendation) || "corrective action update";
  return {
    run_id: run.run_id,
    category: action.category,
    action_key: action.key,
    provider: "figma",
    write: {
      figma_file_key: normalizeText(projectSettings && projectSettings.figma_file_key),
      node_id: nodeId,
      change_type: mapFigmaChangeType(action.category),
      changes: [
        {
          node_id: nodeId,
          change_type: mapFigmaChangeType(action.category),
          summary: changeSummary,
          structure_impact: "medium",
          visual_impact: "medium",
        },
      ],
    },
  };
}

function resolveOpenAiAssistContext(db, userId, explicitAiSettingId = "") {
  const aiSetting = explicitAiSettingId
    ? getPersonalAiSetting(db, userId, explicitAiSettingId)
    : getDefaultPersonalAiSetting(db, userId);
  if (!aiSetting) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "default ai setting is not configured", details: { failure_code: "validation_error" } };
  }
  if (String(aiSetting.provider || "").toLowerCase() !== "openai") {
    throw { status: 400, code: "VALIDATION_ERROR", message: "provider is not supported for action assist", details: { failure_code: "validation_error" } };
  }
  const resolved = resolveSecretReference(aiSetting.secret_ref || aiSetting.secret_id || "", {
    fallbackEnvName: "OPENAI_API_KEY",
  });
  if (!resolved.ok) {
    throw { status: 400, code: "VALIDATION_ERROR", message: resolved.error, details: { failure_code: "validation_error" } };
  }
  return { aiSetting, apiKey: resolved.value };
}

async function handleCorrectiveActionAssist(req, res, db, { userId = "" } = {}) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }
  try {
    const runIdInput = normalizeText(body.run_id);
    let run = null;
    let payload = asObject(body);
    if (runIdInput) {
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
      run = getRun(db, parsedRunId.internalId);
      if (!run) {
        return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
      }
      payload = { ...asObject(run.inputs), ...payload };
    }
    const resolvedAction = resolveCorrectiveAction(payload, {
      action_key: body.action_key,
      category: body.category || body.action_type,
    });
    if (!resolvedAction.action) {
      return jsonError(res, 400, "VALIDATION_ERROR", "corrective action not found", { failure_code: "validation_error" });
    }
    const resolved = resolveOpenAiAssistContext(db, userId, normalizeText(body.ai_setting_id));
    return sendJson(res, 200, await generateCorrectiveActionAssist({
      db,
      actorId: normalizeText(userId),
      tenantId: DEFAULT_TENANT,
      apiKey: resolved.apiKey,
      model: resolved.aiSetting.model || "",
      run,
      plan: resolvedAction.plan,
      action: resolvedAction.action,
    }));
  } catch (error) {
    return jsonError(
      res,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
      error.message || "入力が不正です",
      error.details || { failure_code: "validation_error" }
    );
  }
}

async function handleCorrectiveActionAssistWritePlan(req, res, db) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }
  const runIdInput = normalizeText(body.run_id);
  const provider = normalizeText(body.provider).toLowerCase();
  if (!runIdInput) {
    return jsonError(res, 400, "VALIDATION_ERROR", "run_id is required", { failure_code: "validation_error" });
  }
  if (provider !== "github" && provider !== "figma") {
    return jsonError(res, 400, "VALIDATION_ERROR", "provider is invalid", { failure_code: "validation_error" });
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
  const payload = { ...asObject(run.inputs), ...asObject(body) };
  const resolvedAction = resolveCorrectiveAction(payload, {
    action_key: body.action_key,
    category: body.category || body.action_type,
  });
  if (!resolvedAction.action) {
    return jsonError(res, 400, "VALIDATION_ERROR", "corrective action not found", { failure_code: "validation_error" });
  }
  const projectId = normalizeText(run.project_id);
  const projectSettings = projectId ? getProjectSettings(db, projectId) : null;
  const delegatedPayload = provider === "github"
    ? buildGithubAssistWritePayload({ run, projectSettings, action: resolvedAction.action, assist: body.assist })
    : buildFigmaAssistWritePayload({ run, projectSettings, action: resolvedAction.action, assist: body.assist });
  const delegated = await requestLocalHandler(handleCorrectiveActionWritePlan, delegatedPayload, db);
  if (delegated.statusCode < 200 || delegated.statusCode >= 300) {
    return sendJson(res, delegated.statusCode || 400, delegated.parsed || {
      error: "corrective action write plan failed",
      details: { failure_code: "validation_error" },
    });
  }
  return sendJson(res, delegated.statusCode || 201, delegated.parsed || {});
}

module.exports = {
  handleCorrectiveActionAssist,
  handleCorrectiveActionAssistWritePlan,
};
