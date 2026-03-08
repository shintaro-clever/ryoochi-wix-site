const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { readGithubRepository } = require("../../integrations/github/client");
const { parseProjectIdInput } = require("../projectsStore");
const { getProjectSettings } = require("../projectBindingsStore");
const { resolveGithubTargetSelection } = require("../connectionContext");

async function handleGithubRead(req, res, db) {
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
  const projectIdInput = typeof body.project_id === "string" ? body.project_id.trim() : "";
  if (!projectIdInput) {
    return jsonError(res, 400, "VALIDATION_ERROR", "project_id is required", { failure_code: "validation_error" });
  }
  const resolvedProject = parseProjectIdInput(projectIdInput);
  if (!resolvedProject.ok) {
    return jsonError(
      res,
      resolvedProject.status || 400,
      resolvedProject.code || "VALIDATION_ERROR",
      resolvedProject.message || "project_id is invalid",
      resolvedProject.details || { failure_code: "validation_error" }
    );
  }
  const settings = getProjectSettings(db, resolvedProject.internalId);
  if (!settings) {
    return jsonError(res, 404, "NOT_FOUND", "project not found", { failure_code: "not_found" });
  }
  if (!settings.github_repository) {
    return jsonError(res, 400, "VALIDATION_ERROR", "github_repository is required", {
      failure_code: "validation_error",
    });
  }
  try {
    const selection = resolveGithubTargetSelection({
      projectDefaultBranch: settings.github_default_branch,
      projectDefaultPath: settings.github_default_path,
      runOverrideRef: typeof body.ref === "string" ? body.ref.trim() : "",
      readFilePath: typeof body.file_path === "string" ? body.file_path.trim() : "",
      readTreePath: typeof body.tree_path === "string" ? body.tree_path.trim() : "",
      mode: "read",
    });
    const payload = await readGithubRepository({
      repository: settings.github_repository,
      defaultBranch: settings.github_default_branch,
      secretId: settings.github_secret_id,
      ref: selection.branch,
      filePath: selection.filePath,
      treePath: selection.treePath,
    });
    return sendJson(res, 200, {
      project_id: projectIdInput,
      github_repository: settings.github_repository,
      github_default_branch: settings.github_default_branch || payload.repository.default_branch || "",
      github_default_path: settings.github_default_path || "",
      target_selection: {
        branch: selection.branch,
        path_mode: selection.resolvedPathMode,
        source: selection.source,
      },
      ...payload,
    });
  } catch (error) {
    const code = error.code || "INTEGRATION_ERROR";
    return jsonError(res, error.status || 502, code, error.message || "github read failed", {
      failure_code: error.failure_code || "integration_error",
      reason: error.reason || null,
      provider_status: typeof error.provider_status === "number" ? error.provider_status : null,
    });
  }
}

module.exports = {
  handleGithubRead,
};
