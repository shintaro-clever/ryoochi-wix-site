const {
  getProject,
  parseProjectSharedEnvironmentJson,
  validateConnectorSecretPresence,
} = require("../api/projects");
const { parseProjectIdInput } = require("./projectsStore");

function defaultSharedEnvironment() {
  return {
    github_repository: "",
    github_default_branch: "",
    github_default_path: "",
    github_installation_ref: "",
    github_secret_id: "",
    github_writable_scope: "",
    github_operation_mode: "",
    github_allowed_branches: "",
    figma_file: "",
    figma_file_key: "",
    figma_secret_id: "",
    figma_page_scope: "",
    figma_frame_scope: "",
    figma_writable_scope: "",
    figma_operation_mode: "",
    figma_allowed_frame_scope: "",
    drive_url: "",
  };
}

function toFlatSharedEnvironment(sharedEnvironment) {
  if (!sharedEnvironment || typeof sharedEnvironment !== "object") {
    return defaultSharedEnvironment();
  }
  const githubRepository =
    typeof sharedEnvironment.github?.repository === "string" ? sharedEnvironment.github.repository.trim() : "";
  const githubDefaultBranch =
    typeof sharedEnvironment.github?.default_branch === "string" ? sharedEnvironment.github.default_branch.trim() : "";
  const githubDefaultPath =
    typeof sharedEnvironment.github?.default_path === "string" ? sharedEnvironment.github.default_path.trim() : "";
  const githubInstallationRef =
    typeof sharedEnvironment.github?.installation_ref === "string"
      ? sharedEnvironment.github.installation_ref.trim()
      : "";
  const githubSecretId =
    typeof sharedEnvironment.github?.secret_id === "string" ? sharedEnvironment.github.secret_id.trim() : "";
  const githubWritableScope =
    typeof sharedEnvironment.github?.writable_scope === "string" ? sharedEnvironment.github.writable_scope.trim() : "";
  const githubOperationMode =
    typeof sharedEnvironment.github?.operation_mode === "string" ? sharedEnvironment.github.operation_mode.trim() : "";
  const githubAllowedBranches =
    typeof sharedEnvironment.github?.allowed_branches === "string" ? sharedEnvironment.github.allowed_branches.trim() : "";
  const figmaFile = typeof sharedEnvironment.figma?.file === "string" ? sharedEnvironment.figma.file.trim() : "";
  const figmaFileKey =
    typeof sharedEnvironment.figma?.file_key === "string" ? sharedEnvironment.figma.file_key.trim() : "";
  const figmaSecretId =
    typeof sharedEnvironment.figma?.secret_id === "string" ? sharedEnvironment.figma.secret_id.trim() : "";
  const figmaPageScope =
    typeof sharedEnvironment.figma?.page_scope === "string" ? sharedEnvironment.figma.page_scope.trim() : "";
  const figmaFrameScope =
    typeof sharedEnvironment.figma?.frame_scope === "string" ? sharedEnvironment.figma.frame_scope.trim() : "";
  const figmaWritableScope =
    typeof sharedEnvironment.figma?.writable_scope === "string" ? sharedEnvironment.figma.writable_scope.trim() : "";
  const figmaOperationMode =
    typeof sharedEnvironment.figma?.operation_mode === "string" ? sharedEnvironment.figma.operation_mode.trim() : "";
  const figmaAllowedFrameScope =
    typeof sharedEnvironment.figma?.allowed_frame_scope === "string"
      ? sharedEnvironment.figma.allowed_frame_scope.trim()
      : "";
  const driveUrl = typeof sharedEnvironment.drive?.url === "string" ? sharedEnvironment.drive.url.trim() : "";
  return {
    github_repository: githubRepository,
    github_default_branch: githubDefaultBranch,
    github_default_path: githubDefaultPath,
    github_installation_ref: githubInstallationRef,
    github_secret_id: githubSecretId,
    github_writable_scope: githubWritableScope,
    github_operation_mode: githubOperationMode,
    github_allowed_branches: githubAllowedBranches,
    figma_file: figmaFile,
    figma_file_key: figmaFileKey,
    figma_secret_id: figmaSecretId,
    figma_page_scope: figmaPageScope,
    figma_frame_scope: figmaFrameScope,
    figma_writable_scope: figmaWritableScope,
    figma_operation_mode: figmaOperationMode,
    figma_allowed_frame_scope: figmaAllowedFrameScope,
    drive_url: driveUrl,
  };
}

function loadProjectSharedContext(db, projectIdInput) {
  const text = typeof projectIdInput === "string" ? projectIdInput.trim() : "";
  if (!text) {
    return {
      ok: true,
      internalProjectId: null,
      publicProjectId: null,
      shared_environment: defaultSharedEnvironment(),
    };
  }
  const parsed = parseProjectIdInput(text);
  if (!parsed.ok) {
    return parsed;
  }
  const project = getProject(db, parsed.internalId);
  if (!project) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "project not found",
      details: { failure_code: "not_found" },
    };
  }
  const sharedEnvironment = toFlatSharedEnvironment(parseProjectSharedEnvironmentJson(project.project_shared_env_json));
  const secretPresenceErr = validateConnectorSecretPresence(sharedEnvironment);
  if (secretPresenceErr) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: secretPresenceErr,
      details: { failure_code: "validation_error" },
    };
  }
  return {
    ok: true,
    internalProjectId: parsed.internalId,
    publicProjectId: parsed.publicId,
    shared_environment: sharedEnvironment,
  };
}

module.exports = {
  defaultSharedEnvironment,
  toFlatSharedEnvironment,
  loadProjectSharedContext,
};
