const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { readFigmaFile } = require("../../integrations/figma/client");
const { parseProjectIdInput } = require("../projectsStore");
const { getProjectSettings } = require("../projectBindingsStore");
const { resolveFigmaTargetSelection } = require("../connectionContext");

async function handleFigmaRead(req, res, db) {
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
  if (!settings.figma_file_key && !settings.figma_file) {
    return jsonError(res, 400, "VALIDATION_ERROR", "figma_file_key is required", {
      failure_code: "validation_error",
    });
  }
  try {
    const selection = resolveFigmaTargetSelection({
      projectPageScope: settings.figma_page_scope,
      projectFrameScope: settings.figma_frame_scope,
      projectWritableScope: settings.figma_writable_scope,
      readPageId: typeof body.page_id === "string" ? body.page_id.trim() : "",
      readPageName: typeof body.page_name === "string" ? body.page_name.trim() : "",
      readFrameId: typeof body.frame_id === "string" ? body.frame_id.trim() : "",
      readFrameName: typeof body.frame_name === "string" ? body.frame_name.trim() : "",
      readNodeId: typeof body.node_id === "string" ? body.node_id.trim() : "",
      readNodeIds: Array.isArray(body.node_ids) ? body.node_ids : [],
      runWritableScope: typeof body.figma_writable_scope === "string" ? body.figma_writable_scope.trim() : "",
      mode: "read",
    });
    const payload = await readFigmaFile({
      figmaFile: settings.figma_file,
      figmaFileKey: settings.figma_file_key,
      secretId: settings.figma_secret_id,
      pageId: selection.page.id,
      pageName: selection.page.name,
      frameId: selection.frame.id,
      frameName: selection.frame.name,
      nodeIds: selection.nodeIds,
    });
    return sendJson(res, 200, {
      project_id: projectIdInput,
      figma_file_key: payload.file_key,
      figma_page_scope: settings.figma_page_scope || "",
      figma_frame_scope: settings.figma_frame_scope || "",
      figma_writable_scope: settings.figma_writable_scope || "",
      target_selection: {
        source: selection.source,
        writable_scope: selection.writableScope || "",
      },
      ...payload,
    });
  } catch (error) {
    const code = error.code || "INTEGRATION_ERROR";
    return jsonError(res, error.status || 502, code, error.message || "figma read failed", {
      failure_code: error.failure_code || "integration_error",
      reason: error.reason || null,
      provider_status: typeof error.provider_status === "number" ? error.provider_status : null,
    });
  }
}

module.exports = {
  handleFigmaRead,
};
