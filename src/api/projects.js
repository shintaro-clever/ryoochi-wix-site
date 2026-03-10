const { DEFAULT_TENANT } = require("../db/sqlite");
const crypto = require("crypto");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { withRetry } = require("../db/retry");
const { buildErrorBody } = require("../server/errors");
const PROJECT_SHARED_ENV_SCHEMA_VERSION = "project_shared_env/v1";

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(res, status, code, message, details) {
  sendJson(
    res,
    status,
    buildErrorBody({
      code,
      message,
      details: details || {},
    })
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        req._logBody = parsed;
        resolve(parsed);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function validateHttpsUrl(url) {
  if (typeof url !== "string" || url.trim().length === 0) return "staging_url is required";
  if (url.length > 2048) return "staging_url too long";
  if (!/^https:\/\//i.test(url)) return "staging_url must start with https://";
  return null;
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length === 0) return "name is required";
  if (name.length > 200) return "name too long";
  return null;
}

function normalizeDriveFolderId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const urlMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  const queryMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1];
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) {
    return text;
  }
  return "";
}

function validateDriveFolderId(value, { required = false } = {}) {
  const normalized = normalizeDriveFolderId(value);
  if (!normalized) {
    return required ? "drive_folder_id is required" : null;
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(normalized)) {
    return "drive_folder_id is invalid";
  }
  return null;
}

function validateGithubRepository(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "github_repository is required" : null;
  if (text.length > 300) return "github_repository too long";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return "github_repository is invalid";
  return null;
}

function validateFigmaFile(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "figma_file is required" : null;
  if (text.length > 2048) return "figma_file too long";
  return null;
}

function validateDriveUrl(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "drive_url is required" : null;
  if (text.length > 2048) return "drive_url too long";
  if (!/^https:\/\//i.test(text)) return "drive_url must start with https://";
  return null;
}

function validateSimpleTextField(value, fieldName, { required = false, maxLength = 255 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? `${fieldName} is required` : null;
  if (text.length > maxLength) return `${fieldName} too long`;
  return null;
}

function validateSecretReference(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > 512) return `${fieldName} too long`;
  // Guardrails to avoid storing raw secrets by mistake.
  if (/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|figd_|figma_|sk-[A-Za-z0-9]|sess-[A-Za-z0-9])/i.test(text)) {
    return `${fieldName} must be a reference, not a secret value`;
  }
  return null;
}

function validateGithubPath(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > 400) return `${fieldName} too long`;
  if (text.includes("..") || text.includes("*") || text.includes("?")) {
    return `${fieldName} is invalid`;
  }
  return null;
}

function hasProcessEnvSecret(name) {
  const key = typeof name === "string" ? name.trim() : "";
  if (!key) return false;
  return typeof process.env[key] === "string" && process.env[key].trim().length > 0;
}

function validateConnectorSecretPresence(sharedSettings = {}) {
  const githubRepository =
    typeof sharedSettings.github_repository === "string" ? sharedSettings.github_repository.trim() : "";
  const githubSecretId = typeof sharedSettings.github_secret_id === "string" ? sharedSettings.github_secret_id.trim() : "";
  const figmaFile = typeof sharedSettings.figma_file === "string" ? sharedSettings.figma_file.trim() : "";
  const figmaFileKey = typeof sharedSettings.figma_file_key === "string" ? sharedSettings.figma_file_key.trim() : "";
  const figmaSecretId = typeof sharedSettings.figma_secret_id === "string" ? sharedSettings.figma_secret_id.trim() : "";
  if (githubRepository && !githubSecretId && !hasProcessEnvSecret("GITHUB_TOKEN")) {
    return "github_secret_id is required when github_repository is set (or set GITHUB_TOKEN)";
  }
  if ((figmaFile || figmaFileKey) && !figmaSecretId && !hasProcessEnvSecret("FIGMA_TOKEN")) {
    return "figma_secret_id is required when figma_file or figma_file_key is set (or set FIGMA_TOKEN)";
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultProjectSharedEnvironment() {
  return {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: {
      repository: "",
      default_branch: "",
      default_path: "",
      installation_ref: "",
      secret_id: "",
      operation_mode: "",
      allowed_branches: "",
      writable_scope: "",
    },
    figma: {
      file: "",
      file_key: "",
      secret_id: "",
      page_scope: "",
      frame_scope: "",
      operation_mode: "",
      allowed_frame_scope: "",
      writable_scope: "",
    },
    drive: { url: "" },
  };
}

function parseProjectSharedEnvironment(raw) {
  const base = defaultProjectSharedEnvironment();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return base;
  }
  const githubRepository = typeof raw.github?.repository === "string" ? raw.github.repository.trim() : "";
  const githubDefaultBranch = typeof raw.github?.default_branch === "string" ? raw.github.default_branch.trim() : "";
  const githubDefaultPath = typeof raw.github?.default_path === "string" ? raw.github.default_path.trim() : "";
  const githubInstallationRef = typeof raw.github?.installation_ref === "string" ? raw.github.installation_ref.trim() : "";
  const githubSecretId =
    typeof raw.github?.secret_id === "string"
      ? raw.github.secret_id.trim()
      : typeof raw.github?.token_ref === "string"
        ? raw.github.token_ref.trim()
        : "";
  const githubWritableScope = typeof raw.github?.writable_scope === "string" ? raw.github.writable_scope.trim() : "";
  const githubOperationMode = typeof raw.github?.operation_mode === "string" ? raw.github.operation_mode.trim() : "";
  const githubAllowedBranches =
    typeof raw.github?.allowed_branches === "string" ? raw.github.allowed_branches.trim() : "";
  const figmaFile = typeof raw.figma?.file === "string" ? raw.figma.file.trim() : "";
  const figmaFileKey = typeof raw.figma?.file_key === "string" ? raw.figma.file_key.trim() : "";
  const figmaSecretId = typeof raw.figma?.secret_id === "string" ? raw.figma.secret_id.trim() : "";
  const figmaPageScope = typeof raw.figma?.page_scope === "string" ? raw.figma.page_scope.trim() : "";
  const figmaFrameScope = typeof raw.figma?.frame_scope === "string" ? raw.figma.frame_scope.trim() : "";
  const figmaWritableScope = typeof raw.figma?.writable_scope === "string" ? raw.figma.writable_scope.trim() : "";
  const figmaOperationMode = typeof raw.figma?.operation_mode === "string" ? raw.figma.operation_mode.trim() : "";
  const figmaAllowedFrameScope =
    typeof raw.figma?.allowed_frame_scope === "string" ? raw.figma.allowed_frame_scope.trim() : "";
  const driveUrl = typeof raw.drive?.url === "string" ? raw.drive.url.trim() : "";
  return {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: {
      repository: githubRepository,
      default_branch: githubDefaultBranch,
      default_path: githubDefaultPath,
      installation_ref: githubInstallationRef,
      secret_id: githubSecretId,
      operation_mode: githubOperationMode,
      allowed_branches: githubAllowedBranches,
      writable_scope: githubWritableScope,
    },
    figma: {
      file: figmaFile,
      file_key: figmaFileKey,
      secret_id: figmaSecretId,
      page_scope: figmaPageScope,
      frame_scope: figmaFrameScope,
      operation_mode: figmaOperationMode,
      allowed_frame_scope: figmaAllowedFrameScope,
      writable_scope: figmaWritableScope,
    },
    drive: { url: driveUrl },
  };
}

function parseProjectSharedEnvironmentJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return defaultProjectSharedEnvironment();
  }
  try {
    return parseProjectSharedEnvironment(JSON.parse(text));
  } catch {
    return defaultProjectSharedEnvironment();
  }
}

function listProjects(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
  );
}

function getProject(db, id) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at FROM projects WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, id)
  );
}

function createProject(db, name, stagingUrl, actorId, options = {}) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const description = typeof options.description === "string" ? options.description.trim() : "";
  const driveFolderId = normalizeDriveFolderId(options.drive_folder_id);
  withRetry(() =>
    db.prepare(
      "INSERT INTO projects(tenant_id,id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(
      DEFAULT_TENANT,
      id,
      name,
      description,
      stagingUrl,
      driveFolderId || null,
      JSON.stringify(defaultProjectSharedEnvironment()),
      ts,
      ts
    )
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_CREATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function getProjectSharedEnvironment(db, id) {
  const project = getProject(db, id);
  if (!project) return null;
  return parseProjectSharedEnvironmentJson(project.project_shared_env_json);
}

function putProjectSharedEnvironment(db, id, patch = {}) {
  const current = getProject(db, id);
  if (!current) return null;
  if (patch && typeof patch !== "object") {
    throw new Error("project_shared_environment patch must be object");
  }
  const githubRepository =
    patch.github_repository !== undefined ? String(patch.github_repository || "").trim() : undefined;
  const githubDefaultBranch =
    patch.github_default_branch !== undefined ? String(patch.github_default_branch || "").trim() : undefined;
  const githubDefaultPath =
    patch.github_default_path !== undefined
      ? String(patch.github_default_path || "").trim()
      : patch.github_target_path !== undefined
        ? String(patch.github_target_path || "").trim()
        : undefined;
  const githubInstallationRef =
    patch.github_installation_ref !== undefined ? String(patch.github_installation_ref || "").trim() : undefined;
  const githubSecretId =
    patch.github_secret_id !== undefined
      ? String(patch.github_secret_id || "").trim()
      : patch.github_token_ref !== undefined
        ? String(patch.github_token_ref || "").trim()
        : undefined;
  const githubWritableScope =
    patch.github_writable_scope !== undefined ? String(patch.github_writable_scope || "").trim() : undefined;
  const githubOperationMode =
    patch.github_operation_mode !== undefined ? String(patch.github_operation_mode || "").trim().toLowerCase() : undefined;
  const githubAllowedBranches =
    patch.github_allowed_branches !== undefined ? String(patch.github_allowed_branches || "").trim() : undefined;
  const figmaFile = patch.figma_file !== undefined ? String(patch.figma_file || "").trim() : undefined;
  const figmaFileKey = patch.figma_file_key !== undefined ? String(patch.figma_file_key || "").trim() : undefined;
  const figmaSecretId =
    patch.figma_secret_id !== undefined ? String(patch.figma_secret_id || "").trim() : undefined;
  const figmaPageScope = patch.figma_page_scope !== undefined ? String(patch.figma_page_scope || "").trim() : undefined;
  const figmaFrameScope =
    patch.figma_frame_scope !== undefined ? String(patch.figma_frame_scope || "").trim() : undefined;
  const figmaWritableScope =
    patch.figma_writable_scope !== undefined ? String(patch.figma_writable_scope || "").trim() : undefined;
  const figmaOperationMode =
    patch.figma_operation_mode !== undefined ? String(patch.figma_operation_mode || "").trim().toLowerCase() : undefined;
  const figmaAllowedFrameScope =
    patch.figma_allowed_frame_scope !== undefined ? String(patch.figma_allowed_frame_scope || "").trim() : undefined;
  const driveUrl = patch.drive_url !== undefined ? String(patch.drive_url || "").trim() : undefined;

  const repoErr = validateGithubRepository(githubRepository);
  if (repoErr) throw new Error(repoErr);
  const branchErr = validateSimpleTextField(githubDefaultBranch, "github_default_branch", { maxLength: 200 });
  if (branchErr) throw new Error(branchErr);
  const defaultPathErr = validateGithubPath(githubDefaultPath, "github_default_path");
  if (defaultPathErr) throw new Error(defaultPathErr);
  const installationErr = validateSecretReference(githubInstallationRef, "github_installation_ref");
  if (installationErr) throw new Error(installationErr);
  const githubSecretErr = validateSecretReference(githubSecretId, "github_secret_id");
  if (githubSecretErr) throw new Error(githubSecretErr);
  const githubWritableScopeErr = validateSimpleTextField(githubWritableScope, "github_writable_scope", { maxLength: 200 });
  if (githubWritableScopeErr) throw new Error(githubWritableScopeErr);
  if (
    githubOperationMode !== undefined &&
    githubOperationMode !== "" &&
    !["disabled", "read-only", "read_only", "controlled-write", "controlled_write"].includes(githubOperationMode)
  ) {
    throw new Error("github_operation_mode is invalid");
  }
  const githubAllowedBranchesErr = validateSimpleTextField(githubAllowedBranches, "github_allowed_branches", { maxLength: 800 });
  if (githubAllowedBranchesErr) throw new Error(githubAllowedBranchesErr);
  const figmaErr = validateFigmaFile(figmaFile);
  if (figmaErr) throw new Error(figmaErr);
  const figmaFileKeyErr = validateSimpleTextField(figmaFileKey, "figma_file_key", { maxLength: 200 });
  if (figmaFileKeyErr) throw new Error(figmaFileKeyErr);
  const figmaSecretErr = validateSecretReference(figmaSecretId, "figma_secret_id");
  if (figmaSecretErr) throw new Error(figmaSecretErr);
  const figmaPageScopeErr = validateSimpleTextField(figmaPageScope, "figma_page_scope", { maxLength: 300 });
  if (figmaPageScopeErr) throw new Error(figmaPageScopeErr);
  const figmaFrameScopeErr = validateSimpleTextField(figmaFrameScope, "figma_frame_scope", { maxLength: 300 });
  if (figmaFrameScopeErr) throw new Error(figmaFrameScopeErr);
  const figmaWritableScopeErr = validateSimpleTextField(figmaWritableScope, "figma_writable_scope", { maxLength: 200 });
  if (figmaWritableScopeErr) throw new Error(figmaWritableScopeErr);
  if (
    figmaOperationMode !== undefined &&
    figmaOperationMode !== "" &&
    !["disabled", "read-only", "read_only", "controlled-write", "controlled_write"].includes(figmaOperationMode)
  ) {
    throw new Error("figma_operation_mode is invalid");
  }
  const figmaAllowedFrameScopeErr = validateSimpleTextField(figmaAllowedFrameScope, "figma_allowed_frame_scope", { maxLength: 800 });
  if (figmaAllowedFrameScopeErr) throw new Error(figmaAllowedFrameScopeErr);
  const driveErr = validateDriveUrl(driveUrl);
  if (driveErr) throw new Error(driveErr);

  const prev = parseProjectSharedEnvironmentJson(current.project_shared_env_json);
  const next = {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: {
      repository: githubRepository !== undefined ? githubRepository : prev.github.repository,
      default_branch: githubDefaultBranch !== undefined ? githubDefaultBranch : prev.github.default_branch,
      default_path: githubDefaultPath !== undefined ? githubDefaultPath : prev.github.default_path,
      installation_ref: githubInstallationRef !== undefined ? githubInstallationRef : prev.github.installation_ref,
      secret_id: githubSecretId !== undefined ? githubSecretId : prev.github.secret_id,
      operation_mode: githubOperationMode !== undefined ? githubOperationMode : prev.github.operation_mode,
      allowed_branches: githubAllowedBranches !== undefined ? githubAllowedBranches : prev.github.allowed_branches,
      writable_scope: githubWritableScope !== undefined ? githubWritableScope : prev.github.writable_scope,
    },
    figma: {
      file: figmaFile !== undefined ? figmaFile : prev.figma.file,
      file_key: figmaFileKey !== undefined ? figmaFileKey : prev.figma.file_key,
      secret_id: figmaSecretId !== undefined ? figmaSecretId : prev.figma.secret_id,
      page_scope: figmaPageScope !== undefined ? figmaPageScope : prev.figma.page_scope,
      frame_scope: figmaFrameScope !== undefined ? figmaFrameScope : prev.figma.frame_scope,
      operation_mode: figmaOperationMode !== undefined ? figmaOperationMode : prev.figma.operation_mode,
      allowed_frame_scope:
        figmaAllowedFrameScope !== undefined ? figmaAllowedFrameScope : prev.figma.allowed_frame_scope,
      writable_scope: figmaWritableScope !== undefined ? figmaWritableScope : prev.figma.writable_scope,
    },
    drive: { url: driveUrl !== undefined ? driveUrl : prev.drive.url },
  };
  withRetry(() =>
    db
      .prepare("UPDATE projects SET project_shared_env_json=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(next), nowIso(), DEFAULT_TENANT, id)
  );
  return next;
}

function patchProject(db, id, patch, actorId) {
  const existing = getProject(db, id);
  if (!existing) return null;

  const nextName = typeof patch.name === "string" ? patch.name : existing.name;
  const nextUrl = typeof patch.staging_url === "string" ? patch.staging_url : existing.staging_url;
  const nextDescription =
    typeof patch.description === "string" ? patch.description : existing.description || "";
  const nextDriveFolderId =
    patch.drive_folder_id !== undefined
      ? normalizeDriveFolderId(patch.drive_folder_id) || null
      : existing.drive_folder_id || null;

  withRetry(() =>
    db
      .prepare(
        "UPDATE projects SET name=?, description=?, staging_url=?, drive_folder_id=?, updated_at=? WHERE tenant_id=? AND id=?"
      )
      .run(nextName, nextDescription, nextUrl, nextDriveFolderId, nowIso(), DEFAULT_TENANT, id)
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_UPDATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function deleteProject(db, id, actorId) {
  const info = withRetry(() =>
    db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id)
  );
  if (info.changes > 0) {
    recordAudit({
      db,
      action: AUDIT_ACTIONS.PROJECT_DELETE,
      tenantId: DEFAULT_TENANT,
      actorId,
      meta: { project_id: id },
    });
  }
  return info.changes > 0;
}

module.exports = {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  validateDriveFolderId,
  validateGithubRepository,
  validateFigmaFile,
  validateDriveUrl,
  validateSecretReference,
  validateConnectorSecretPresence,
  normalizeDriveFolderId,
  defaultProjectSharedEnvironment,
  parseProjectSharedEnvironment,
  parseProjectSharedEnvironmentJson,
  getProjectSharedEnvironment,
  putProjectSharedEnvironment,
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
};
