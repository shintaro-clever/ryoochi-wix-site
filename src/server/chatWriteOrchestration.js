const { PassThrough } = require("stream");
const { parseRunIdInput, getRun } = require("../api/runs");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function splitRepository(repository) {
  const text = normalizeText(repository);
  if (!text || !text.includes("/")) return { owner: "", repo: "" };
  const [owner, repo] = text.split("/", 2);
  return { owner: normalizeText(owner), repo: normalizeText(repo) };
}

function requestLocalHandler(handler, payload, db) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/internal/chat-orchestration";
    req.headers = { "content-type": "application/json" };
    req.setEncoding = () => {};
    req.on("error", reject);

    const res = new PassThrough();
    const resHeaders = {};
    let statusCode = 200;
    res.setHeader = (key, value) => {
      resHeaders[String(key).toLowerCase()] = value;
    };
    res.writeHead = (code, headers = {}) => {
      statusCode = code;
      Object.entries(headers).forEach(([k, v]) => {
        resHeaders[String(k).toLowerCase()] = v;
      });
    };
    const chunks = [];
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) res.write(chunk);
      let parsed = null;
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      resolve({ statusCode, headers: resHeaders, body, parsed });
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

function buildGithubPayload(write = {}, run = {}) {
  const payload = write && typeof write === "object" ? write : {};
  const shared = run.inputs?.shared_environment && typeof run.inputs.shared_environment === "object"
    ? run.inputs.shared_environment
    : {};
  const repository = normalizeText(payload.repository) || normalizeText(shared.github_repository);
  const split = splitRepository(repository);
  return {
    owner: normalizeText(payload.owner) || split.owner,
    repo: normalizeText(payload.repo) || split.repo,
    head_branch: normalizeText(payload.head_branch),
    file_path: normalizeText(payload.file_path),
    file_content: typeof payload.file_content === "string" ? payload.file_content : undefined,
    changes: Array.isArray(payload.changes) ? payload.changes : undefined,
    write_path_allowlist: payload.write_path_allowlist,
    create_pr: payload.create_pr,
    github_token: typeof payload.github_token === "string" ? payload.github_token : undefined,
    title: normalizeText(payload.title) || "chat orchestrated write",
    body: typeof payload.body === "string" ? payload.body : undefined,
  };
}

function buildFigmaPayload(write = {}, run = {}) {
  const payload = write && typeof write === "object" ? write : {};
  const figmaCtx = run.inputs?.connection_context?.figma && typeof run.inputs.connection_context.figma === "object"
    ? run.inputs.connection_context.figma
    : {};
  const target = figmaCtx.target && typeof figmaCtx.target === "object" ? figmaCtx.target : {};
  return {
    page_id: normalizeText(payload.page_id) || normalizeText(target.page_id),
    page_name: normalizeText(payload.page_name) || normalizeText(target.page_name),
    frame_id: normalizeText(payload.frame_id) || normalizeText(target.frame_id),
    frame_name: normalizeText(payload.frame_name) || normalizeText(target.frame_name),
    node_id: normalizeText(payload.node_id),
    node_ids: Array.isArray(payload.node_ids) ? payload.node_ids : undefined,
    change_type: normalizeText(payload.change_type),
    changes: Array.isArray(payload.changes) ? payload.changes : undefined,
    text: typeof payload.text === "string" ? payload.text : undefined,
    properties: payload.properties,
    layout: payload.layout,
    parent_node_id: normalizeText(payload.parent_node_id),
    node_type: normalizeText(payload.node_type),
    name: normalizeText(payload.name),
    figma_secret_id: typeof payload.figma_secret_id === "string" ? payload.figma_secret_id : undefined,
    visual_fidelity_score: payload.visual_fidelity_score,
    structural_reproduction_rate: payload.structural_reproduction_rate,
    safety_score: payload.safety_score,
  };
}

async function planChatWrite({
  db,
  runIdPublic,
  write,
  handleGithubWritePlan,
  handleFigmaWritePlan,
} = {}) {
  const parsedRun = parseRunIdInput(runIdPublic);
  if (!parsedRun.ok) {
    return { ok: false, statusCode: 400, error: { failure_code: "validation_error", message: "run_id is invalid" } };
  }
  const run = getRun(db, parsedRun.internalId);
  if (!run) {
    return { ok: false, statusCode: 404, error: { failure_code: "not_found", message: "run not found" } };
  }
  const provider = normalizeText(write && write.provider).toLowerCase();
  if (provider !== "github" && provider !== "figma") {
    return { ok: false, statusCode: 400, error: { failure_code: "validation_error", message: "write.provider is invalid" } };
  }
  if (provider === "github") {
    const payload = {
      run_id: runIdPublic,
      ...buildGithubPayload(write, run),
    };
    const result = await requestLocalHandler(handleGithubWritePlan, payload, db);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { ok: false, statusCode: result.statusCode, error: result.parsed?.details || { failure_code: "validation_error", message: "github write plan failed" } };
    }
    return { ok: true, provider, plan: result.parsed };
  }
  const payload = {
    run_id: runIdPublic,
    ...buildFigmaPayload(write, run),
  };
  const result = await requestLocalHandler(handleFigmaWritePlan, payload, db);
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return { ok: false, statusCode: result.statusCode, error: result.parsed?.details || { failure_code: "validation_error", message: "figma write plan failed" } };
  }
  return { ok: true, provider, plan: result.parsed };
}

async function confirmChatWrite({
  db,
  runIdPublic,
  write,
  handleGithubPrCreate,
  handleFigmaWrite,
} = {}) {
  const parsedRun = parseRunIdInput(runIdPublic);
  if (!parsedRun.ok) {
    return { ok: false, statusCode: 400, error: { failure_code: "validation_error", message: "run_id is invalid" } };
  }
  const run = getRun(db, parsedRun.internalId);
  if (!run) {
    return { ok: false, statusCode: 404, error: { failure_code: "not_found", message: "run not found" } };
  }
  const provider = normalizeText(write && write.provider).toLowerCase();
  const plannedActionId = normalizeText(write && write.planned_action_id);
  const confirmToken = normalizeText(write && write.confirm_token);
  if (!plannedActionId || !confirmToken) {
    return { ok: false, statusCode: 400, error: { failure_code: "validation_error", message: "planned_action_id and confirm_token are required" } };
  }
  if (provider !== "github" && provider !== "figma") {
    return { ok: false, statusCode: 400, error: { failure_code: "validation_error", message: "write.provider is invalid" } };
  }
  if (provider === "github") {
    const payload = {
      run_id: runIdPublic,
      confirm: true,
      planned_action_id: plannedActionId,
      confirm_token: confirmToken,
      ...buildGithubPayload(write, run),
    };
    const result = await requestLocalHandler(handleGithubPrCreate, payload, db);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { ok: false, statusCode: result.statusCode, error: result.parsed?.details || { failure_code: "validation_error", message: "github confirm write failed" } };
    }
    return { ok: true, provider, result: result.parsed };
  }
  const payload = {
    run_id: runIdPublic,
    confirm: true,
    planned_action_id: plannedActionId,
    confirm_token: confirmToken,
    ...buildFigmaPayload(write, run),
  };
  const result = await requestLocalHandler(handleFigmaWrite, payload, db);
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return { ok: false, statusCode: result.statusCode, error: result.parsed?.details || { failure_code: "validation_error", message: "figma confirm write failed" } };
  }
  return { ok: true, provider, result: result.parsed };
}

module.exports = {
  planChatWrite,
  confirmChatWrite,
};
