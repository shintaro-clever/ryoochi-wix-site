const { DEFAULT_TENANT } = require("../db");
const {
  validateGithubRepository,
  validateFigmaFile,
  validateDriveUrl,
  validateSecretReference,
  validateConnectorSecretPresence,
  getProjectSharedEnvironment,
  putProjectSharedEnvironment,
} = require("../api/projects");

const ALLOWED_BINDING_KEYS = ["ai", "github", "figma"];

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateOptionalTextField(value, fieldName, maxLength = 255) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maxLength) return `${fieldName} too long`;
  return null;
}

function normalizeOperationMode(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return "";
  if (text === "read-only" || text === "read_only") return "read_only";
  if (text === "controlled-write" || text === "controlled_write") return "controlled_write";
  if (text === "disabled") return "disabled";
  return text;
}

function validateOperationMode(value, fieldName) {
  const mode = normalizeOperationMode(value);
  if (!mode) return null;
  if (mode === "disabled" || mode === "read_only" || mode === "controlled_write") return null;
  return `${fieldName} is invalid`;
}

function projectExists(db, projectId) {
  return !!db
    .prepare("SELECT id FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
}

// --- Connections ---
function defaultConnections(projectId) {
  return {
    project_id: projectId,
    items: ALLOWED_BINDING_KEYS.map((key) => ({ key, enabled: false })),
  };
}

function getProjectConnections(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_bindings_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_bindings_json) return defaultConnections(projectId);
  try {
    const parsed = JSON.parse(row.project_bindings_json);
    if (!Array.isArray(parsed.items)) return defaultConnections(projectId);
    return { project_id: projectId, items: parsed.items };
  } catch {
    return defaultConnections(projectId);
  }
}

function readProjectBindingsRaw(db, projectId) {
  const row = db
    .prepare("SELECT project_bindings_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_bindings_json) return {};
  try {
    const parsed = JSON.parse(row.project_bindings_json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function putProjectConnections(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (!Array.isArray(body.items)) throw validationError("items must be an array");
  const seen = new Set();
  for (const item of body.items) {
    if (!item || typeof item !== "object") throw validationError("invalid item");
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!ALLOWED_BINDING_KEYS.includes(key)) throw validationError(`unknown key: ${key}`);
    if (seen.has(key)) throw validationError(`duplicate key: ${key}`);
    seen.add(key);
    if (typeof item.enabled !== "boolean") throw validationError("enabled must be boolean");
  }
  const now = new Date().toISOString();
  const current = readProjectBindingsRaw(db, projectId);
  const data = {
    ...current,
    items: body.items.map(({ key, enabled }) => ({ key, enabled })),
  };
  db.prepare(
    "UPDATE projects SET project_bindings_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, items: data.items };
}

// --- Drive ---
function defaultDrive(projectId) {
  return { project_id: projectId, folder_id: "", folder_url: "", enabled: false };
}

function getProjectDrive(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_drive_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_drive_json) return defaultDrive(projectId);
  try {
    const parsed = JSON.parse(row.project_drive_json);
    return {
      project_id: projectId,
      folder_id: typeof parsed.folder_id === "string" ? parsed.folder_id : "",
      folder_url: typeof parsed.folder_url === "string" ? parsed.folder_url : "",
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
    };
  } catch {
    return defaultDrive(projectId);
  }
}

function getProjectSettings(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const shared = getProjectSharedEnvironment(db, projectId);
  const bindings = readProjectBindingsRaw(db, projectId);
  const drive = getProjectDrive(db, projectId) || defaultDrive(projectId);
  const settings = bindings.settings && typeof bindings.settings === "object" ? bindings.settings : {};
  const githubRepository = shared?.github?.repository || normalizeText(settings.github_repository);
  const githubDefaultBranch = shared?.github?.default_branch || normalizeText(settings.github_default_branch);
  const githubDefaultPath = shared?.github?.default_path || normalizeText(settings.github_default_path);
  const githubInstallationRef = shared?.github?.installation_ref || normalizeText(settings.github_installation_ref);
  const githubSecretId =
    shared?.github?.secret_id || normalizeText(settings.github_secret_id || settings.github_token_ref);
  const githubWritableScope = shared?.github?.writable_scope || normalizeText(settings.github_writable_scope);
  const githubOperationMode = shared?.github?.operation_mode || normalizeText(settings.github_operation_mode);
  const githubAllowedBranches = shared?.github?.allowed_branches || normalizeText(settings.github_allowed_branches);
  const figmaFile = shared?.figma?.file || normalizeText(settings.figma_file);
  const figmaFileKey = shared?.figma?.file_key || normalizeText(settings.figma_file_key);
  const figmaSecretId = shared?.figma?.secret_id || normalizeText(settings.figma_secret_id || settings.figma_token_ref);
  const figmaPageScope = shared?.figma?.page_scope || normalizeText(settings.figma_page_scope);
  const figmaFrameScope = shared?.figma?.frame_scope || normalizeText(settings.figma_frame_scope);
  const figmaWritableScope = shared?.figma?.writable_scope || normalizeText(settings.figma_writable_scope);
  const figmaOperationMode = shared?.figma?.operation_mode || normalizeText(settings.figma_operation_mode);
  const figmaAllowedFrameScope = shared?.figma?.allowed_frame_scope || normalizeText(settings.figma_allowed_frame_scope);
  const driveUrl = shared?.drive?.url || normalizeText(drive.folder_url);
  return {
    project_id: projectId,
    github_repository: githubRepository,
    github_default_branch: githubDefaultBranch,
    github_default_path: githubDefaultPath,
    github_installation_ref: githubInstallationRef,
    github_secret_id: githubSecretId,
    github_writable_scope: githubWritableScope,
    github_operation_mode: normalizeOperationMode(githubOperationMode),
    github_allowed_branches: githubAllowedBranches,
    figma_file: figmaFile,
    figma_file_key: figmaFileKey,
    figma_secret_id: figmaSecretId,
    figma_page_scope: figmaPageScope,
    figma_frame_scope: figmaFrameScope,
    figma_writable_scope: figmaWritableScope,
    figma_operation_mode: normalizeOperationMode(figmaOperationMode),
    figma_allowed_frame_scope: figmaAllowedFrameScope,
    drive_url: driveUrl,
  };
}

function putProjectDrive(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (body.folder_id !== undefined && typeof body.folder_id !== "string")
    throw validationError("folder_id must be string");
  if (body.folder_url !== undefined && typeof body.folder_url !== "string")
    throw validationError("folder_url must be string");
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    throw validationError("enabled must be boolean");

  const current = getProjectDrive(db, projectId) || defaultDrive(projectId);
  const data = {
    folder_id: typeof body.folder_id === "string" ? body.folder_id : current.folder_id,
    folder_url: typeof body.folder_url === "string" ? body.folder_url : current.folder_url,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE projects SET project_drive_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, ...data };
}

function putProjectSettings(db, projectId, body = {}) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (body.github_repository !== undefined && typeof body.github_repository !== "string") {
    throw validationError("github_repository must be string");
  }
  if (body.figma_file !== undefined && typeof body.figma_file !== "string") {
    throw validationError("figma_file must be string");
  }
  if (body.github_default_branch !== undefined && typeof body.github_default_branch !== "string") {
    throw validationError("github_default_branch must be string");
  }
  if (body.github_default_path !== undefined && typeof body.github_default_path !== "string") {
    throw validationError("github_default_path must be string");
  }
  if (body.github_target_path !== undefined && typeof body.github_target_path !== "string") {
    throw validationError("github_target_path must be string");
  }
  if (body.github_installation_ref !== undefined && typeof body.github_installation_ref !== "string") {
    throw validationError("github_installation_ref must be string");
  }
  if (body.github_secret_id !== undefined && typeof body.github_secret_id !== "string") {
    throw validationError("github_secret_id must be string");
  }
  if (body.github_token_ref !== undefined && typeof body.github_token_ref !== "string") {
    throw validationError("github_token_ref must be string");
  }
  if (body.github_writable_scope !== undefined && typeof body.github_writable_scope !== "string") {
    throw validationError("github_writable_scope must be string");
  }
  if (body.github_operation_mode !== undefined && typeof body.github_operation_mode !== "string") {
    throw validationError("github_operation_mode must be string");
  }
  if (body.github_allowed_branches !== undefined && typeof body.github_allowed_branches !== "string") {
    throw validationError("github_allowed_branches must be string");
  }
  if (body.figma_file_key !== undefined && typeof body.figma_file_key !== "string") {
    throw validationError("figma_file_key must be string");
  }
  if (body.figma_secret_id !== undefined && typeof body.figma_secret_id !== "string") {
    throw validationError("figma_secret_id must be string");
  }
  if (body.figma_token_ref !== undefined && typeof body.figma_token_ref !== "string") {
    throw validationError("figma_token_ref must be string");
  }
  if (body.figma_page_scope !== undefined && typeof body.figma_page_scope !== "string") {
    throw validationError("figma_page_scope must be string");
  }
  if (body.figma_frame_scope !== undefined && typeof body.figma_frame_scope !== "string") {
    throw validationError("figma_frame_scope must be string");
  }
  if (body.figma_writable_scope !== undefined && typeof body.figma_writable_scope !== "string") {
    throw validationError("figma_writable_scope must be string");
  }
  if (body.figma_operation_mode !== undefined && typeof body.figma_operation_mode !== "string") {
    throw validationError("figma_operation_mode must be string");
  }
  if (body.figma_allowed_frame_scope !== undefined && typeof body.figma_allowed_frame_scope !== "string") {
    throw validationError("figma_allowed_frame_scope must be string");
  }
  if (body.drive_url !== undefined && typeof body.drive_url !== "string") {
    throw validationError("drive_url must be string");
  }
  const repoErr = validateGithubRepository(body.github_repository);
  const figmaErr = validateFigmaFile(body.figma_file);
  const branchErr = validateOptionalTextField(body.github_default_branch, "github_default_branch", 200);
  const defaultPathErr = validateOptionalTextField(
    body.github_default_path !== undefined ? body.github_default_path : body.github_target_path,
    "github_default_path",
    400
  );
  const installationErr = validateSecretReference(body.github_installation_ref, "github_installation_ref");
  const githubSecretIdInput = body.github_secret_id !== undefined ? body.github_secret_id : body.github_token_ref;
  const githubSecretIdErr = validateSecretReference(githubSecretIdInput, "github_secret_id");
  const githubWritableScopeErr = validateOptionalTextField(body.github_writable_scope, "github_writable_scope", 200);
  const githubOperationModeErr = validateOperationMode(body.github_operation_mode, "github_operation_mode");
  const githubAllowedBranchesErr = validateOptionalTextField(body.github_allowed_branches, "github_allowed_branches", 800);
  const figmaFileKeyErr = validateOptionalTextField(body.figma_file_key, "figma_file_key", 200);
  const figmaSecretIdInput = body.figma_secret_id !== undefined ? body.figma_secret_id : body.figma_token_ref;
  const figmaSecretIdErr = validateSecretReference(figmaSecretIdInput, "figma_secret_id");
  const figmaPageScopeErr = validateOptionalTextField(body.figma_page_scope, "figma_page_scope", 300);
  const figmaFrameScopeErr = validateOptionalTextField(body.figma_frame_scope, "figma_frame_scope", 300);
  const figmaWritableScopeErr = validateOptionalTextField(body.figma_writable_scope, "figma_writable_scope", 200);
  const figmaOperationModeErr = validateOperationMode(body.figma_operation_mode, "figma_operation_mode");
  const figmaAllowedFrameScopeErr = validateOptionalTextField(
    body.figma_allowed_frame_scope,
    "figma_allowed_frame_scope",
    800
  );
  const driveErr = validateDriveUrl(body.drive_url);
  if (
    repoErr ||
    figmaErr ||
    branchErr ||
    defaultPathErr ||
    installationErr ||
    githubSecretIdErr ||
    githubWritableScopeErr ||
    githubOperationModeErr ||
    githubAllowedBranchesErr ||
    figmaFileKeyErr ||
    figmaSecretIdErr ||
    figmaPageScopeErr ||
    figmaFrameScopeErr ||
    figmaWritableScopeErr ||
    figmaOperationModeErr ||
    figmaAllowedFrameScopeErr ||
    driveErr
  ) {
    throw validationError(
      repoErr ||
        figmaErr ||
        branchErr ||
        defaultPathErr ||
        installationErr ||
        githubSecretIdErr ||
        githubWritableScopeErr ||
        githubOperationModeErr ||
        githubAllowedBranchesErr ||
        figmaFileKeyErr ||
        figmaSecretIdErr ||
        figmaPageScopeErr ||
        figmaFrameScopeErr ||
        figmaWritableScopeErr ||
        figmaOperationModeErr ||
        figmaAllowedFrameScopeErr ||
        driveErr
    );
  }

  const currentSettings = getProjectSettings(db, projectId) || {
    project_id: projectId,
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
  const nextSettings = {
    github_repository:
      body.github_repository !== undefined ? normalizeText(body.github_repository) : currentSettings.github_repository,
    github_default_branch:
      body.github_default_branch !== undefined
        ? normalizeText(body.github_default_branch)
        : currentSettings.github_default_branch,
    github_default_path:
      body.github_default_path !== undefined
        ? normalizeText(body.github_default_path)
        : body.github_target_path !== undefined
          ? normalizeText(body.github_target_path)
          : currentSettings.github_default_path,
    github_installation_ref:
      body.github_installation_ref !== undefined
        ? normalizeText(body.github_installation_ref)
        : currentSettings.github_installation_ref,
    github_secret_id:
      body.github_secret_id !== undefined
        ? normalizeText(body.github_secret_id)
        : body.github_token_ref !== undefined
          ? normalizeText(body.github_token_ref)
          : currentSettings.github_secret_id,
    github_writable_scope:
      body.github_writable_scope !== undefined
        ? normalizeText(body.github_writable_scope)
        : currentSettings.github_writable_scope,
    github_operation_mode:
      body.github_operation_mode !== undefined
        ? normalizeOperationMode(body.github_operation_mode)
        : normalizeOperationMode(currentSettings.github_operation_mode),
    github_allowed_branches:
      body.github_allowed_branches !== undefined
        ? normalizeText(body.github_allowed_branches)
        : currentSettings.github_allowed_branches,
    figma_file: body.figma_file !== undefined ? normalizeText(body.figma_file) : currentSettings.figma_file,
    figma_file_key: body.figma_file_key !== undefined ? normalizeText(body.figma_file_key) : currentSettings.figma_file_key,
    figma_secret_id:
      body.figma_secret_id !== undefined
        ? normalizeText(body.figma_secret_id)
        : body.figma_token_ref !== undefined
          ? normalizeText(body.figma_token_ref)
          : currentSettings.figma_secret_id,
    figma_page_scope:
      body.figma_page_scope !== undefined ? normalizeText(body.figma_page_scope) : currentSettings.figma_page_scope,
    figma_frame_scope:
      body.figma_frame_scope !== undefined ? normalizeText(body.figma_frame_scope) : currentSettings.figma_frame_scope,
    figma_writable_scope:
      body.figma_writable_scope !== undefined
        ? normalizeText(body.figma_writable_scope)
        : currentSettings.figma_writable_scope,
    figma_operation_mode:
      body.figma_operation_mode !== undefined
        ? normalizeOperationMode(body.figma_operation_mode)
        : normalizeOperationMode(currentSettings.figma_operation_mode),
    figma_allowed_frame_scope:
      body.figma_allowed_frame_scope !== undefined
        ? normalizeText(body.figma_allowed_frame_scope)
        : currentSettings.figma_allowed_frame_scope,
    drive_url: body.drive_url !== undefined ? normalizeText(body.drive_url) : currentSettings.drive_url,
  };

  const secretPresenceErr = validateConnectorSecretPresence({
    github_repository: nextSettings.github_repository,
    github_secret_id: nextSettings.github_secret_id,
    figma_file: nextSettings.figma_file,
    figma_file_key: nextSettings.figma_file_key,
    figma_secret_id: nextSettings.figma_secret_id,
  });
  if (secretPresenceErr) {
    throw validationError(secretPresenceErr);
  }

  putProjectSharedEnvironment(db, projectId, {
    github_repository: nextSettings.github_repository,
    github_default_branch: nextSettings.github_default_branch,
    github_default_path: nextSettings.github_default_path,
    github_installation_ref: nextSettings.github_installation_ref,
    github_secret_id: nextSettings.github_secret_id,
    github_operation_mode: nextSettings.github_operation_mode,
    github_allowed_branches: nextSettings.github_allowed_branches,
    github_writable_scope: nextSettings.github_writable_scope,
    figma_file: nextSettings.figma_file,
    figma_file_key: nextSettings.figma_file_key,
    figma_secret_id: nextSettings.figma_secret_id,
    figma_page_scope: nextSettings.figma_page_scope,
    figma_frame_scope: nextSettings.figma_frame_scope,
    figma_operation_mode: nextSettings.figma_operation_mode,
    figma_allowed_frame_scope: nextSettings.figma_allowed_frame_scope,
    figma_writable_scope: nextSettings.figma_writable_scope,
    drive_url: nextSettings.drive_url,
  });

  const now = new Date().toISOString();
  const bindings = readProjectBindingsRaw(db, projectId);
  const mergedBindings = {
    ...bindings,
    settings: {
      ...(bindings.settings && typeof bindings.settings === "object" ? bindings.settings : {}),
      github_repository: nextSettings.github_repository,
      github_default_branch: nextSettings.github_default_branch,
      github_default_path: nextSettings.github_default_path,
      github_installation_ref: nextSettings.github_installation_ref,
      github_secret_id: nextSettings.github_secret_id,
      github_operation_mode: nextSettings.github_operation_mode,
      github_allowed_branches: nextSettings.github_allowed_branches,
      github_writable_scope: nextSettings.github_writable_scope,
      figma_file: nextSettings.figma_file,
      figma_file_key: nextSettings.figma_file_key,
      figma_secret_id: nextSettings.figma_secret_id,
      figma_page_scope: nextSettings.figma_page_scope,
      figma_frame_scope: nextSettings.figma_frame_scope,
      figma_operation_mode: nextSettings.figma_operation_mode,
      figma_allowed_frame_scope: nextSettings.figma_allowed_frame_scope,
      figma_writable_scope: nextSettings.figma_writable_scope,
    },
  };
  db.prepare("UPDATE projects SET project_bindings_json=?, updated_at=? WHERE tenant_id=? AND id=?").run(
    JSON.stringify(mergedBindings),
    now,
    DEFAULT_TENANT,
    projectId
  );

  const drivePayload = {
    folder_url: nextSettings.drive_url,
  };
  putProjectDrive(db, projectId, drivePayload);
  return getProjectSettings(db, projectId);
}

module.exports = {
  getProjectConnections,
  putProjectConnections,
  getProjectDrive,
  putProjectDrive,
  getProjectSettings,
  putProjectSettings,
};
