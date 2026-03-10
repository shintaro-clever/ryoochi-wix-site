const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");
const { KINDS, buildPublicId, parsePublicIdFor, isUuid } = require("../id/publicIds");
const { collectClassifiedReasons } = require("../fidelity/reasonTaxonomy");
const { normalizeFidelityReasonSnapshot } = require("../db/fidelityReasons");

const API_RUNS_PROJECT_ID = "api:runs";
const RUN_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
});

function nowIso() {
  return new Date().toISOString();
}

function toPublicRunId(internalId) {
  return isUuid(internalId) ? buildPublicId(KINDS.run, internalId) : internalId;
}

function toPublicProjectId(projectId) {
  return isUuid(projectId) ? buildPublicId(KINDS.project, projectId) : projectId;
}

function toPublicThreadId(threadId) {
  return isUuid(threadId) ? buildPublicId(KINDS.thread, threadId) : threadId;
}

function toPublicAiSettingId(aiSettingId) {
  return isUuid(aiSettingId) ? buildPublicId(KINDS.ai_setting, aiSettingId) : aiSettingId;
}

function parseTrackingId(kind, input, { nullable = true } = {}) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) {
    return nullable ? { ok: true, internalId: null } : { ok: false, message: `${kind}_id is required` };
  }
  if (isUuid(text)) {
    return { ok: true, internalId: text };
  }
  const parsed = parsePublicIdFor(kind, text);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message || `${kind}_id format is invalid`, details: parsed.details || { failure_code: "validation_error" } };
  }
  return { ok: true, internalId: parsed.internalId };
}

function parseRunIdInput(runId) {
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "run_id is required",
      details: { failure_code: "validation_error" },
    };
  }
  if (isUuid(id)) {
    return { ok: true, internalId: id, publicId: toPublicRunId(id), mode: "legacy_uuid" };
  }
  const parsed = parsePublicIdFor(KINDS.run, id);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: parsed.message || "run_id format is invalid",
      details: parsed.details || { failure_code: "validation_error" },
    };
  }
  return { ok: true, internalId: parsed.internalId, publicId: parsed.publicId, mode: "public_id" };
}

function parseInputs(inputsJson) {
  if (typeof inputsJson !== "string" || inputsJson.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(inputsJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text;
  }
  return "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value == null ? {} : value));
}

function extractRetryMetadata(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const retry = payload.retry && typeof payload.retry === "object" ? payload.retry : {};
  const sourceRunId = firstNonEmptyText(retry.source_run_id, payload.retry_of_run_id);
  return {
    retry_of_run_id: sourceRunId || null,
    retry_kind: firstNonEmptyText(retry.retry_kind, payload.retry_kind) || null,
    retry_requested_at: firstNonEmptyText(retry.requested_at, payload.retry_requested_at) || null,
  };
}

function listRetryChildren(db, sourceRunId) {
  if (!db || typeof db.prepare !== "function" || !sourceRunId) return [];
  return withRetry(() =>
    db
      .prepare("SELECT id, inputs_json, created_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC")
      .all(DEFAULT_TENANT)
      .map((row) => ({
        id: row.id,
        inputs: parseInputs(row.inputs_json),
        created_at: row.created_at,
      }))
      .filter((row) => extractRetryMetadata(row.inputs).retry_of_run_id === toPublicRunId(sourceRunId))
      .map((row) => ({
        run_id: toPublicRunId(row.id),
        created_at: row.created_at,
        retry_kind: extractRetryMetadata(row.inputs).retry_kind,
      }))
  );
}

function normalizeSharedEnvironment(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const githubRepository = typeof source.github_repository === "string" ? source.github_repository.trim() : "";
  const githubDefaultBranch = typeof source.github_default_branch === "string" ? source.github_default_branch.trim() : "";
  const githubDefaultPath = typeof source.github_default_path === "string" ? source.github_default_path.trim() : "";
  const githubInstallationRef =
    typeof source.github_installation_ref === "string" ? source.github_installation_ref.trim() : "";
  const githubSecretId = typeof source.github_secret_id === "string" ? source.github_secret_id.trim() : "";
  const githubWritableScope =
    typeof source.github_writable_scope === "string" ? source.github_writable_scope.trim() : "";
  const githubOperationMode =
    typeof source.github_operation_mode === "string" ? source.github_operation_mode.trim() : "";
  const githubAllowedBranches =
    typeof source.github_allowed_branches === "string" ? source.github_allowed_branches.trim() : "";
  const figmaFile = typeof source.figma_file === "string" ? source.figma_file.trim() : "";
  const figmaFileKey = typeof source.figma_file_key === "string" ? source.figma_file_key.trim() : "";
  const figmaSecretId = typeof source.figma_secret_id === "string" ? source.figma_secret_id.trim() : "";
  const figmaPageScope = typeof source.figma_page_scope === "string" ? source.figma_page_scope.trim() : "";
  const figmaFrameScope = typeof source.figma_frame_scope === "string" ? source.figma_frame_scope.trim() : "";
  const figmaWritableScope = typeof source.figma_writable_scope === "string" ? source.figma_writable_scope.trim() : "";
  const figmaOperationMode =
    typeof source.figma_operation_mode === "string" ? source.figma_operation_mode.trim() : "";
  const figmaAllowedFrameScope =
    typeof source.figma_allowed_frame_scope === "string" ? source.figma_allowed_frame_scope.trim() : "";
  const driveUrl = typeof source.drive_url === "string" ? source.drive_url.trim() : "";
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

function normalizeGithubConnectionContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const repositoryMetadata = raw.repository_metadata && typeof raw.repository_metadata === "object"
    ? raw.repository_metadata
    : {};
  const filePathsInput = Array.isArray(raw.file_paths) ? raw.file_paths : [];
  const filePaths = [];
  const seen = new Set();
  for (const item of filePathsInput) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/^\/+/, "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    filePaths.push(text);
  }
  return {
    provider: "github",
    status: typeof raw.status === "string" ? raw.status.trim() || "skipped" : "skipped",
    branch: typeof raw.branch === "string" ? raw.branch.trim() : "",
    latest_commit_sha: typeof raw.latest_commit_sha === "string" ? raw.latest_commit_sha.trim() : "",
    file_paths: filePaths,
    selection_source:
      raw.selection_source && typeof raw.selection_source === "object"
        ? {
            branch:
              typeof raw.selection_source.branch === "string" ? raw.selection_source.branch.trim() || "repository_default" : "repository_default",
            path: typeof raw.selection_source.path === "string" ? raw.selection_source.path.trim() || "none" : "none",
          }
        : { branch: "repository_default", path: "none" },
    repository_metadata: {
      full_name: typeof repositoryMetadata.full_name === "string" ? repositoryMetadata.full_name.trim() : "",
      default_branch:
        typeof repositoryMetadata.default_branch === "string" ? repositoryMetadata.default_branch.trim() : "",
      private: typeof repositoryMetadata.private === "boolean" ? repositoryMetadata.private : null,
      html_url: typeof repositoryMetadata.html_url === "string" ? repositoryMetadata.html_url.trim() : "",
    },
    error:
      raw.error && typeof raw.error === "object"
        ? {
            code: typeof raw.error.code === "string" ? raw.error.code.trim() : "INTEGRATION_ERROR",
            failure_code:
              typeof raw.error.failure_code === "string" ? raw.error.failure_code.trim() : "integration_error",
            reason: typeof raw.error.reason === "string" ? raw.error.reason.trim() : "service_unavailable",
            message: typeof raw.error.message === "string" ? raw.error.message.trim() : "github read failed",
          }
        : null,
  };
}

function normalizeFigmaNodeSummaries(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((node) => {
      if (!node || typeof node !== "object") return null;
      return {
        id: typeof node.id === "string" ? node.id.trim() : "",
        type: typeof node.type === "string" ? node.type.trim() : "",
        name: typeof node.name === "string" ? node.name.trim() : "",
        parent_id: typeof node.parent_id === "string" ? node.parent_id.trim() : null,
        text_preview: typeof node.text_preview === "string" ? node.text_preview : null,
        component_kind: typeof node.component_kind === "string" ? node.component_kind.trim() : "none",
        auto_layout:
          node.auto_layout && typeof node.auto_layout === "object"
            ? {
                layout_mode:
                  typeof node.auto_layout.layout_mode === "string" ? node.auto_layout.layout_mode.trim() : null,
                primary_axis_sizing_mode:
                  typeof node.auto_layout.primary_axis_sizing_mode === "string"
                    ? node.auto_layout.primary_axis_sizing_mode.trim()
                    : null,
                counter_axis_sizing_mode:
                  typeof node.auto_layout.counter_axis_sizing_mode === "string"
                    ? node.auto_layout.counter_axis_sizing_mode.trim()
                    : null,
              }
            : { layout_mode: null, primary_axis_sizing_mode: null, counter_axis_sizing_mode: null },
      };
    })
    .filter((node) => node && node.id);
}

function normalizeFigmaConnectionContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const target = raw.target && typeof raw.target === "object" ? raw.target : {};
  const summary = raw.layout_summary && typeof raw.layout_summary === "object" ? raw.layout_summary : {};
  const source = raw.target_selection_source && typeof raw.target_selection_source === "object" ? raw.target_selection_source : {};
  const writeGuard = raw.write_guard && typeof raw.write_guard === "object" ? raw.write_guard : {};
  const comparisonTarget =
    raw.comparison_target && typeof raw.comparison_target === "object" ? raw.comparison_target : {};
  return {
    provider: "figma",
    status: typeof raw.status === "string" ? raw.status.trim() || "skipped" : "skipped",
    file_key: typeof raw.file_key === "string" ? raw.file_key.trim() : "",
    last_modified: typeof raw.last_modified === "string" ? raw.last_modified.trim() : "",
    target: {
      page_id: typeof target.page_id === "string" ? target.page_id.trim() : "",
      page_name: typeof target.page_name === "string" ? target.page_name.trim() : "",
      frame_id: typeof target.frame_id === "string" ? target.frame_id.trim() : "",
      frame_name: typeof target.frame_name === "string" ? target.frame_name.trim() : "",
      node_ids: Array.isArray(target.node_ids)
        ? target.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [],
    },
    comparison_target: {
      id: typeof comparisonTarget.id === "string" ? comparisonTarget.id.trim() : "",
      mode: typeof comparisonTarget.mode === "string" ? comparisonTarget.mode.trim() : "",
    },
    target_selection_source: {
      page: typeof source.page === "string" ? source.page.trim() || "none" : "none",
      frame: typeof source.frame === "string" ? source.frame.trim() || "none" : "none",
      nodes: typeof source.nodes === "string" ? source.nodes.trim() || "none" : "none",
      writable_scope:
        typeof source.writable_scope === "string" ? source.writable_scope.trim() || "none" : "none",
    },
    writable_scope: typeof raw.writable_scope === "string" ? raw.writable_scope.trim() : "",
    write_guard: {
      writable_scope: typeof writeGuard.writable_scope === "string" ? writeGuard.writable_scope.trim() : "",
      requires_confirmation: Boolean(writeGuard.requires_confirmation),
      reason: typeof writeGuard.reason === "string" ? writeGuard.reason.trim() : null,
    },
    node_summaries: normalizeFigmaNodeSummaries(raw.node_summaries),
    layout_summary: {
      node_count: typeof summary.node_count === "number" ? summary.node_count : 0,
      text_node_count: typeof summary.text_node_count === "number" ? summary.text_node_count : 0,
      component_node_count: typeof summary.component_node_count === "number" ? summary.component_node_count : 0,
      instance_node_count: typeof summary.instance_node_count === "number" ? summary.instance_node_count : 0,
      auto_layout_node_count: typeof summary.auto_layout_node_count === "number" ? summary.auto_layout_node_count : 0,
    },
    error:
      raw.error && typeof raw.error === "object"
        ? {
            code: typeof raw.error.code === "string" ? raw.error.code.trim() : "INTEGRATION_ERROR",
            failure_code:
              typeof raw.error.failure_code === "string" ? raw.error.failure_code.trim() : "integration_error",
            reason: typeof raw.error.reason === "string" ? raw.error.reason.trim() : "service_unavailable",
            message: typeof raw.error.message === "string" ? raw.error.message.trim() : "figma read failed",
          }
        : null,
  };
}

function normalizeConnectionContext(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    github: normalizeGithubConnectionContext(source.github),
    figma: normalizeFigmaConnectionContext(source.figma),
  };
}

function normalizeFidelityEnvironment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw;
  const environments = source.environments && typeof source.environments === "object" ? source.environments : {};
  const conditions = source.conditions && typeof source.conditions === "object" ? source.conditions : {};
  const viewport = conditions.viewport && typeof conditions.viewport === "object" ? conditions.viewport : {};
  const authState = conditions.auth_state && typeof conditions.auth_state === "object" ? conditions.auth_state : {};
  const fixtureData = conditions.fixture_data && typeof conditions.fixture_data === "object" ? conditions.fixture_data : {};
  const normalizeEnvEntry = (entry, name) => {
    const obj = entry && typeof entry === "object" ? entry : {};
    return {
      name,
      url: typeof obj.url === "string" ? obj.url.trim() : "",
      theme: typeof obj.theme === "string" ? obj.theme.trim() : "",
      auth_state: typeof obj.auth_state === "string" ? obj.auth_state.trim() : "",
    };
  };
  return {
    version: typeof source.version === "string" ? source.version.trim() : "",
    target_environment: typeof source.target_environment === "string" ? source.target_environment.trim() : "",
    compare_environments: Array.isArray(source.compare_environments)
      ? source.compare_environments.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [],
    environments: {
      localhost: normalizeEnvEntry(environments.localhost, "localhost"),
      staging: normalizeEnvEntry(environments.staging, "staging"),
      production: normalizeEnvEntry(environments.production, "production"),
    },
    conditions: {
      viewport: {
        preset: typeof viewport.preset === "string" ? viewport.preset.trim() : "",
        width: typeof viewport.width === "number" ? viewport.width : 0,
        height: typeof viewport.height === "number" ? viewport.height : 0,
      },
      theme: typeof conditions.theme === "string" ? conditions.theme.trim() : "",
      auth_state: {
        localhost: typeof authState.localhost === "string" ? authState.localhost.trim() : "",
        staging: typeof authState.staging === "string" ? authState.staging.trim() : "",
        production: typeof authState.production === "string" ? authState.production.trim() : "",
      },
      fixture_data: {
        mode: typeof fixtureData.mode === "string" ? fixtureData.mode.trim() : "",
        dataset_id: typeof fixtureData.dataset_id === "string" ? fixtureData.dataset_id.trim() : "",
        snapshot_id: typeof fixtureData.snapshot_id === "string" ? fixtureData.snapshot_id.trim() : "",
        seed: typeof fixtureData.seed === "string" ? fixtureData.seed.trim() : "",
        flags:
          fixtureData.flags && typeof fixtureData.flags === "object" && !Array.isArray(fixtureData.flags)
            ? fixtureData.flags
            : {},
      },
    },
  };
}

function normalizePathList(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/^\/+/, "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function extractSearchRequestedBy(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const contextUsed = payload.context_used && typeof payload.context_used === "object" ? payload.context_used : {};
  const externalAudit =
    (contextUsed.external_audit && typeof contextUsed.external_audit === "object" ? contextUsed.external_audit : null) ||
    (payload.external_audit && typeof payload.external_audit === "object" ? payload.external_audit : null);
  const actor = externalAudit && externalAudit.actor && typeof externalAudit.actor === "object" ? externalAudit.actor : {};
  return firstNonEmptyText(actor.requested_by, payload.requested_by, payload.actor_id);
}

function extractSearchProvider(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const externalOperations = ensureRunExternalOperations(payload);
  for (let i = externalOperations.length - 1; i >= 0; i -= 1) {
    const provider = firstNonEmptyText(externalOperations[i] && externalOperations[i].provider);
    if (provider) return provider;
  }
  const connectionContext = payload.connection_context && typeof payload.connection_context === "object" ? payload.connection_context : {};
  const github = connectionContext.github && typeof connectionContext.github === "object" ? connectionContext.github : null;
  const figma = connectionContext.figma && typeof connectionContext.figma === "object" ? connectionContext.figma : null;
  return firstNonEmptyText(github ? "github" : "", figma ? "figma" : "");
}

function buildFigmaResolvedTargetPaths(target) {
  const pageId = typeof target?.page_id === "string" ? target.page_id.trim() : "";
  const frameId = typeof target?.frame_id === "string" ? target.frame_id.trim() : "";
  const nodeIds = Array.isArray(target?.node_ids)
    ? target.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const paths = [];
  if (pageId) {
    paths.push(`page/${pageId}`);
  }
  if (pageId && frameId) {
    paths.push(`page/${pageId}/frame/${frameId}`);
  } else if (frameId) {
    paths.push(`frame/${frameId}`);
  }
  for (const nodeId of nodeIds) {
    if (pageId && frameId) {
      paths.push(`page/${pageId}/frame/${frameId}/node/${nodeId}`);
      continue;
    }
    if (frameId) {
      paths.push(`frame/${frameId}/node/${nodeId}`);
      continue;
    }
    if (pageId) {
      paths.push(`page/${pageId}/node/${nodeId}`);
      continue;
    }
    paths.push(`node/${nodeId}`);
  }
  return normalizePathList(paths);
}

function normalizeExternalReferencesSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const github = raw.github && typeof raw.github === "object" ? raw.github : {};
  const figma = raw.figma && typeof raw.figma === "object" ? raw.figma : {};
  const figmaTarget = figma.target && typeof figma.target === "object" ? figma.target : {};
  const githubResolvedPaths = normalizePathList(
    Array.isArray(github.resolved_target_paths) ? github.resolved_target_paths : github.file_paths
  );
  const figmaNodeIds = Array.isArray(figmaTarget.node_ids)
    ? figmaTarget.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const figmaResolvedPaths = normalizePathList(
    Array.isArray(figma.resolved_target_paths) ? figma.resolved_target_paths : buildFigmaResolvedTargetPaths(figmaTarget)
  );
  return {
    github: {
      repository: typeof github.repository === "string" ? github.repository.trim() : "",
      branch: typeof github.branch === "string" ? github.branch.trim() : "",
      latest_commit_sha: typeof github.latest_commit_sha === "string" ? github.latest_commit_sha.trim() : "",
      file_paths: normalizePathList(github.file_paths),
      resolved_target_paths: githubResolvedPaths,
    },
    figma: {
      file_key: typeof figma.file_key === "string" ? figma.file_key.trim() : "",
      target: {
        page_id: typeof figmaTarget.page_id === "string" ? figmaTarget.page_id.trim() : "",
        frame_id: typeof figmaTarget.frame_id === "string" ? figmaTarget.frame_id.trim() : "",
        node_ids: figmaNodeIds,
      },
      resolved_target_paths: figmaResolvedPaths,
    },
  };
}

function buildExternalReferencesSnapshotFromConnection(connectionContext) {
  const context = connectionContext && typeof connectionContext === "object" ? connectionContext : {};
  const github = context.github && typeof context.github === "object" ? context.github : {};
  const figma = context.figma && typeof context.figma === "object" ? context.figma : {};
  return normalizeExternalReferencesSnapshot({
    github: {
      repository:
        github.repository_metadata && typeof github.repository_metadata === "object"
          ? github.repository_metadata.full_name
          : "",
      branch: github.branch,
      latest_commit_sha: github.latest_commit_sha,
      file_paths: Array.isArray(github.file_paths) ? github.file_paths : [],
      resolved_target_paths: Array.isArray(github.file_paths) ? github.file_paths : [],
    },
    figma: {
      file_key: figma.file_key,
      target:
        figma.target && typeof figma.target === "object"
          ? {
              page_id: figma.target.page_id,
              frame_id: figma.target.frame_id,
              node_ids: Array.isArray(figma.target.node_ids) ? figma.target.node_ids : [],
            }
          : { page_id: "", frame_id: "", node_ids: [] },
      resolved_target_paths:
        figma.target && typeof figma.target === "object" ? buildFigmaResolvedTargetPaths(figma.target) : [],
    },
  });
}

function ensureRunExternalReferencesSnapshot(inputs) {
  const source = inputs && typeof inputs === "object" ? inputs : {};
  const normalizedConnection = normalizeConnectionContext(source.connection_context);
  const normalizedExisting = normalizeExternalReferencesSnapshot(source.external_references_snapshot);
  const builtFromConnection = buildExternalReferencesSnapshotFromConnection(normalizedConnection);
  return normalizedExisting || builtFromConnection;
}

function normalizeExternalOperationEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const target = raw.target && typeof raw.target === "object" ? raw.target : {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const artifacts = raw.artifacts && typeof raw.artifacts === "object" ? raw.artifacts : {};
  const nodeIds = Array.isArray(target.node_ids)
    ? target.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const targetPaths = normalizePathList(target.paths);
  const artifactPaths = normalizePathList(artifacts.paths);
  const artifactNodeIds = Array.isArray(artifacts.figma_node_ids)
    ? artifacts.figma_node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const statusText = typeof result.status === "string" ? result.status.trim().toLowerCase() : "";
  const status = statusText === "ok" || statusText === "succeeded" ? "ok" : statusText === "skipped" ? "skipped" : "error";
  return {
    provider: typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : "unknown",
    operation_type:
      typeof raw.operation_type === "string" && raw.operation_type.trim() ? raw.operation_type.trim() : "unknown",
    target: {
      repository: typeof target.repository === "string" ? target.repository.trim() : "",
      branch: typeof target.branch === "string" ? target.branch.trim() : "",
      path: typeof target.path === "string" ? target.path.trim().replace(/^\/+/, "") : "",
      paths: targetPaths,
      file_key: typeof target.file_key === "string" ? target.file_key.trim() : "",
      page_id: typeof target.page_id === "string" ? target.page_id.trim() : "",
      frame_id: typeof target.frame_id === "string" ? target.frame_id.trim() : "",
      node_ids: nodeIds,
    },
    result: {
      status,
      failure_code: typeof result.failure_code === "string" ? result.failure_code.trim() || null : null,
      reason: typeof result.reason === "string" ? result.reason.trim() || null : null,
    },
    artifacts: {
      commit_sha: typeof artifacts.commit_sha === "string" ? artifacts.commit_sha.trim() || null : null,
      branch: typeof artifacts.branch === "string" ? artifacts.branch.trim() || null : null,
      pr_url: typeof artifacts.pr_url === "string" ? artifacts.pr_url.trim() || null : null,
      pr_number: typeof artifacts.pr_number === "number" ? artifacts.pr_number : null,
      figma_file_key: typeof artifacts.figma_file_key === "string" ? artifacts.figma_file_key.trim() || null : null,
      figma_page_id: typeof artifacts.figma_page_id === "string" ? artifacts.figma_page_id.trim() || null : null,
      figma_frame_id: typeof artifacts.figma_frame_id === "string" ? artifacts.figma_frame_id.trim() || null : null,
      figma_node_ids: artifactNodeIds,
      fidelity_score:
        typeof artifacts.fidelity_score === "number" && Number.isFinite(artifacts.fidelity_score)
          ? artifacts.fidelity_score
          : null,
      fidelity_status:
        typeof artifacts.fidelity_status === "string" && artifacts.fidelity_status.trim()
          ? artifacts.fidelity_status.trim()
          : null,
      paths: artifactPaths,
    },
    recorded_at:
      typeof raw.recorded_at === "string" && raw.recorded_at.trim() ? raw.recorded_at.trim() : new Date().toISOString(),
  };
}

function normalizeExternalOperations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => normalizeExternalOperationEntry(entry)).filter(Boolean).slice(0, 200);
}

function ensureRunExternalOperations(inputs) {
  const source = inputs && typeof inputs === "object" ? inputs : {};
  const ctx = source.context_used && typeof source.context_used === "object" ? source.context_used : {};
  const list = Array.isArray(source.external_operations)
    ? source.external_operations
    : Array.isArray(ctx.external_operations)
      ? ctx.external_operations
      : [];
  return normalizeExternalOperations(list);
}

function safeAuditText(value) {
  return require("../ai/openaiDataBoundary").sanitizeSecretLikeText(value, { fallbackRedact: true });
}

function buildExternalAuditView({
  runId = "",
  projectId = "",
  status = "",
  inputs = {},
  externalOperations = [],
  plannedActions = [],
  figmaBeforeAfter = null,
} = {}) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const readPlan = payload.external_read_plan && typeof payload.external_read_plan === "object"
    ? payload.external_read_plan
    : null;
  const readTargets = readPlan && readPlan.read_targets && typeof readPlan.read_targets === "object"
    ? readPlan.read_targets
    : null;
  const actorId = safeAuditText(payload.requested_by || payload.actor_id || "");
  const fgValidation = payload.fg_validation && typeof payload.fg_validation === "object" ? payload.fg_validation : null;
  const operations = Array.isArray(externalOperations) ? externalOperations : [];
  return {
    actor: {
      requested_by: actorId || null,
      ai_setting_id: typeof payload.ai_setting_id === "string" && payload.ai_setting_id.trim() ? payload.ai_setting_id.trim() : null,
      thread_id: typeof payload.thread_id === "string" && payload.thread_id.trim() ? payload.thread_id.trim() : null,
    },
    scope: {
      project_id: projectId || null,
      run_id: runId || null,
      status: status || null,
    },
    read: {
      plan_status: readPlan ? String(readPlan.actionability || "") : null,
      confirm_required: readPlan ? Boolean(readPlan.confirm_required) : null,
      confirm_required_reason: readPlan ? safeAuditText(readPlan.confirm_required_reason || "") || null : null,
      targets: readTargets || null,
    },
    write_plan: (Array.isArray(plannedActions) ? plannedActions : []).map((entry) => ({
      action_id: entry && typeof entry.action_id === "string" ? entry.action_id : "",
      provider: entry && typeof entry.provider === "string" ? entry.provider : "",
      operation_type: entry && typeof entry.operation_type === "string" ? entry.operation_type : "",
      status: entry && typeof entry.status === "string" ? entry.status : "",
      target: entry && entry.target && typeof entry.target === "object" ? entry.target : {},
      requested_at: entry && typeof entry.requested_at === "string" ? entry.requested_at : "",
      confirmed_at: entry && typeof entry.confirmed_at === "string" ? entry.confirmed_at : null,
    })),
    write_actual: operations.map((entry) => ({
      provider: entry && typeof entry.provider === "string" ? entry.provider : "",
      operation_type: entry && typeof entry.operation_type === "string" ? entry.operation_type : "",
      target: entry && entry.target && typeof entry.target === "object" ? entry.target : {},
      result: entry && entry.result && typeof entry.result === "object"
        ? {
            status: entry.result.status || "",
            failure_code: entry.result.failure_code || null,
            reason: safeAuditText(entry.result.reason || "") || null,
          }
        : { status: "", failure_code: null, reason: null },
      artifacts: entry && entry.artifacts && typeof entry.artifacts === "object" ? entry.artifacts : {},
      recorded_at: entry && typeof entry.recorded_at === "string" ? entry.recorded_at : "",
    })),
    figma_fidelity: fgValidation
      ? {
          status: typeof fgValidation.status === "string" ? fgValidation.status : "",
          score_total:
            typeof fgValidation.score_total === "number"
              ? fgValidation.score_total
              : typeof fgValidation.score === "number"
                ? fgValidation.score
                : 0,
          passed: typeof fgValidation.passed === "boolean" ? fgValidation.passed : null,
          hard_fail_reasons: Array.isArray(fgValidation.hard_fail_reasons) ? fgValidation.hard_fail_reasons : [],
          axes: fgValidation.axes && typeof fgValidation.axes === "object" ? fgValidation.axes : {},
        }
      : null,
    figma_before_after: figmaBeforeAfter && typeof figmaBeforeAfter === "object" ? figmaBeforeAfter : null,
  };
}

function hashConfirmToken(token) {
  const text = typeof token === "string" ? token.trim() : "";
  if (!text) return "";
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalizePlannedActionEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const target = raw.target && typeof raw.target === "object" ? raw.target : {};
  const statusRaw = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
  const status =
    statusRaw === "confirmed" || statusRaw === "executed" || statusRaw === "cancelled" || statusRaw === "expired"
      ? statusRaw
      : "confirm_required";
  return {
    action_id:
      typeof raw.action_id === "string" && raw.action_id.trim() ? raw.action_id.trim() : crypto.randomUUID(),
    provider: typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : "unknown",
    operation_type:
      typeof raw.operation_type === "string" && raw.operation_type.trim() ? raw.operation_type.trim() : "unknown",
    target: {
      repository: typeof target.repository === "string" ? target.repository.trim() : "",
      branch: typeof target.branch === "string" ? target.branch.trim() : "",
      path: typeof target.path === "string" ? target.path.trim().replace(/^\/+/, "") : "",
      file_key: typeof target.file_key === "string" ? target.file_key.trim() : "",
      page_id: typeof target.page_id === "string" ? target.page_id.trim() : "",
      frame_id: typeof target.frame_id === "string" ? target.frame_id.trim() : "",
      node_ids: Array.isArray(target.node_ids)
        ? target.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [],
    },
    requested_at:
      typeof raw.requested_at === "string" && raw.requested_at.trim() ? raw.requested_at.trim() : new Date().toISOString(),
    expires_at:
      typeof raw.expires_at === "string" && raw.expires_at.trim()
        ? raw.expires_at.trim()
        : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    status,
    confirm_token_hash: typeof raw.confirm_token_hash === "string" ? raw.confirm_token_hash.trim() : "",
    confirmed_at:
      typeof raw.confirmed_at === "string" && raw.confirmed_at.trim() ? raw.confirmed_at.trim() : null,
  };
}

function normalizePlannedActions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => normalizePlannedActionEntry(entry)).filter(Boolean).slice(-200);
}

function ensureRunPlannedActions(inputs) {
  const source = inputs && typeof inputs === "object" ? inputs : {};
  const ctx = source.context_used && typeof source.context_used === "object" ? source.context_used : {};
  const list = Array.isArray(source.planned_actions)
    ? source.planned_actions
    : Array.isArray(ctx.planned_actions)
      ? ctx.planned_actions
      : [];
  return normalizePlannedActions(list);
}

function appendRunPlannedAction(db, runId, plannedAction) {
  if (!db || typeof db.prepare !== "function" || !runId) return null;
  const normalized = normalizePlannedActionEntry(plannedAction);
  if (!normalized) return null;
  const row = withRetry(() =>
    db
      .prepare("SELECT inputs_json FROM runs WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) return null;
  const parsedInputs = parseInputs(row.inputs_json);
  const current = ensureRunPlannedActions(parsedInputs);
  const next = [...current, normalized].slice(-200);
  const contextUsed = parsedInputs.context_used && typeof parsedInputs.context_used === "object" ? parsedInputs.context_used : {};
  const updatedInputs = {
    ...parsedInputs,
    planned_actions: next,
    context_used: {
      ...contextUsed,
      planned_actions: next,
    },
  };
  const changes = withRetry(() =>
    db
      .prepare("UPDATE runs SET inputs_json=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(updatedInputs), nowIso(), DEFAULT_TENANT, runId).changes
  );
  return changes > 0 ? normalized : null;
}

function confirmRunPlannedAction(db, runId, { actionId, confirmToken, provider = "", operationType = "" } = {}) {
  if (!db || typeof db.prepare !== "function" || !runId) {
    return { ok: false, failure_code: "validation_error", reason: "run_id is required" };
  }
  const tokenHash = hashConfirmToken(confirmToken);
  if (!actionId || !tokenHash) {
    return { ok: false, failure_code: "validation_error", reason: "confirm_token is required" };
  }
  const row = withRetry(() =>
    db
      .prepare("SELECT inputs_json FROM runs WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) {
    return { ok: false, failure_code: "not_found", reason: "run not found" };
  }
  const parsedInputs = parseInputs(row.inputs_json);
  const current = ensureRunPlannedActions(parsedInputs);
  const now = Date.now();
  let matched = null;
  const next = current.map((entry) => {
    const candidate = normalizePlannedActionEntry(entry);
    if (!candidate) return entry;
    if (candidate.action_id !== actionId) return candidate;
    if (provider && candidate.provider !== provider) return candidate;
    if (operationType && candidate.operation_type !== operationType) return candidate;
    if (!candidate.confirm_token_hash || candidate.confirm_token_hash !== tokenHash) {
      matched = { error: "confirm token mismatch", failure_code: "validation_error" };
      return candidate;
    }
    if (Date.parse(candidate.expires_at) < now) {
      matched = { error: "planned action expired", failure_code: "validation_error" };
      return { ...candidate, status: "expired" };
    }
    matched = { ok: true, action: candidate };
    return { ...candidate, status: "confirmed", confirmed_at: new Date().toISOString() };
  });
  if (!matched || !matched.ok) {
    return { ok: false, failure_code: matched?.failure_code || "validation_error", reason: matched?.error || "planned action not found" };
  }
  const contextUsed = parsedInputs.context_used && typeof parsedInputs.context_used === "object" ? parsedInputs.context_used : {};
  const updatedInputs = {
    ...parsedInputs,
    planned_actions: next,
    context_used: {
      ...contextUsed,
      planned_actions: next,
    },
  };
  withRetry(() =>
    db
      .prepare("UPDATE runs SET inputs_json=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(updatedInputs), nowIso(), DEFAULT_TENANT, runId)
  );
  return { ok: true, action: matched.action };
}

function normalizeFigmaSnapshot(raw, sourceLabel) {
  if (!raw || typeof raw !== "object") return null;
  const targetRaw = raw.target_resolution && typeof raw.target_resolution === "object" ? raw.target_resolution : raw.target;
  const target = targetRaw && typeof targetRaw === "object" ? targetRaw : {};
  const pageFromResolution = target.page && typeof target.page === "object" ? target.page : {};
  const frameFromResolution = target.frame && typeof target.frame === "object" ? target.frame : {};
  const comparisonTarget = target.comparison_target && typeof target.comparison_target === "object" ? target.comparison_target : {};
  const nodeIds = Array.isArray(target.node_ids)
    ? target.node_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const pageId = typeof target.page_id === "string" ? target.page_id.trim() : "";
  const pageName = typeof target.page_name === "string" ? target.page_name.trim() : "";
  const frameId = typeof target.frame_id === "string" ? target.frame_id.trim() : "";
  const frameName = typeof target.frame_name === "string" ? target.frame_name.trim() : "";
  const file = raw.file && typeof raw.file === "object" ? raw.file : {};
  return {
    source: sourceLabel,
    file_key: typeof raw.file_key === "string" ? raw.file_key.trim() : "",
    last_modified:
      typeof raw.last_modified === "string"
        ? raw.last_modified.trim()
        : typeof file.last_modified === "string"
          ? file.last_modified.trim()
          : "",
    target: {
      page_id: pageId || (typeof pageFromResolution.id === "string" ? pageFromResolution.id.trim() : ""),
      page_name: pageName || (typeof pageFromResolution.name === "string" ? pageFromResolution.name.trim() : ""),
      frame_id: frameId || (typeof frameFromResolution.id === "string" ? frameFromResolution.id.trim() : ""),
      frame_name: frameName || (typeof frameFromResolution.name === "string" ? frameFromResolution.name.trim() : ""),
      node_ids: nodeIds,
    },
    comparison_target: {
      id: typeof comparisonTarget.id === "string" ? comparisonTarget.id.trim() : "",
      mode: typeof comparisonTarget.mode === "string" ? comparisonTarget.mode.trim() : "",
    },
  };
}

function normalizeFigmaStructureDiff(raw) {
  if (!raw || typeof raw !== "object") return null;
  const structural = raw.structural_reproduction && typeof raw.structural_reproduction === "object" ? raw.structural_reproduction : {};
  const counts = raw.counts && typeof raw.counts === "object" ? raw.counts : {};
  return {
    major_diff_detected: Boolean(raw.major_diff_detected),
    structural_reproduction: {
      rate: typeof structural.rate === "number" ? structural.rate : 0,
      pass: Boolean(structural.pass),
      status: typeof structural.status === "string" ? structural.status.trim() : "unknown",
    },
    counts: {
      target_mismatches: typeof counts.target_mismatches === "number" ? counts.target_mismatches : 0,
      missing_in_candidate: typeof counts.missing_in_candidate === "number" ? counts.missing_in_candidate : 0,
      parent_mismatches: typeof counts.parent_mismatches === "number" ? counts.parent_mismatches : 0,
      auto_layout_mismatches: typeof counts.auto_layout_mismatches === "number" ? counts.auto_layout_mismatches : 0,
      text_mismatches: typeof counts.text_mismatches === "number" ? counts.text_mismatches : 0,
      component_mismatches: typeof counts.component_mismatches === "number" ? counts.component_mismatches : 0,
    },
  };
}

function normalizeFigmaVisualDiff(raw, fgValidation) {
  const source = raw && typeof raw === "object" ? raw : {};
  const highlights = Array.isArray(source.highlights)
    ? source.highlights.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  const score =
    typeof source.score === "number"
      ? source.score
      : fgValidation && typeof fgValidation === "object" && fgValidation.axes && typeof fgValidation.axes === "object"
        ? Number(fgValidation.axes.visual_fidelity || 0)
        : 0;
  return {
    score: Number.isFinite(score) ? score : 0,
    highlights,
  };
}

function buildFigmaBeforeAfter(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const before =
    normalizeFigmaSnapshot(payload.figma_before, "figma_before") ||
    normalizeFigmaSnapshot(payload.figma_baseline, "figma_baseline");
  const after =
    normalizeFigmaSnapshot(payload.figma_after, "figma_after") ||
    normalizeFigmaSnapshot(payload.connection_context?.figma, "connection_context.figma");
  const structureDiff = normalizeFigmaStructureDiff(payload.figma_structure_diff);
  const visualDiff = normalizeFigmaVisualDiff(payload.figma_visual_diff, payload.fg_validation);
  if (!before && !after && !structureDiff && visualDiff.highlights.length === 0 && visualDiff.score === 0) {
    return null;
  }
  const majorChangePoints = [];
  if (structureDiff) {
    if (structureDiff.counts.target_mismatches > 0) majorChangePoints.push("target mismatch");
    if (structureDiff.counts.parent_mismatches > 0) majorChangePoints.push("parent-child changed");
    if (structureDiff.counts.auto_layout_mismatches > 0) majorChangePoints.push("auto layout changed");
    if (structureDiff.counts.text_mismatches > 0) majorChangePoints.push("text changed");
    if (structureDiff.counts.component_mismatches > 0) majorChangePoints.push("component usage changed");
  }
  for (const item of visualDiff.highlights) {
    if (majorChangePoints.length >= 8) break;
    majorChangePoints.push(item);
  }
  return {
    before,
    after,
    major_change_points: majorChangePoints,
    structure_diff_summary: structureDiff,
    visual_diff_summary: visualDiff,
  };
}

function buildFidelityReasonSnapshot(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const existingRaw =
    payload.fidelity_reasons && typeof payload.fidelity_reasons === "object" ? payload.fidelity_reasons : null;
  const driftSignals =
    payload.drift_signals && typeof payload.drift_signals === "object" ? payload.drift_signals : {};
  const collected = collectClassifiedReasons(payload, {
    manual_design_drift: Boolean(driftSignals.manual_design_drift || payload.manual_design_drift),
    code_drift_from_approved_design: Boolean(
      driftSignals.code_drift_from_approved_design || payload.code_drift_from_approved_design
    ),
  });
  if (
    collected &&
    collected.counts &&
    typeof collected.counts.total === "number" &&
    collected.counts.total > 0
  ) {
    return normalizeFidelityReasonSnapshot({ ...collected, updated_at: new Date().toISOString() });
  }
  if (existingRaw) {
    return normalizeFidelityReasonSnapshot(existingRaw);
  }
  return null;
}

function asSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectFidelityArtifactPaths(captureResult, externalOperations) {
  const out = [];
  const seen = new Set();
  const pushPath = (input) => {
    if (typeof input !== "string") return;
    const normalized = input.trim().replace(/^\/+/, "");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  const capture = asSafeObject(captureResult);
  if (capture) {
    pushPath(capture.output_path);
    const stateResults = Array.isArray(capture.state_results) ? capture.state_results : [];
    stateResults.forEach((item) => {
      if (item && typeof item === "object") {
        pushPath(item.artifact_path);
      }
    });
  }
  const ops = Array.isArray(externalOperations) ? externalOperations : [];
  ops.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const target = asSafeObject(entry.target);
    const artifacts = asSafeObject(entry.artifacts);
    if (target) {
      pushPath(target.path);
      const targetPaths = Array.isArray(target.paths) ? target.paths : [];
      targetPaths.forEach((item) => pushPath(item));
    }
    if (artifacts) {
      const artifactPaths = Array.isArray(artifacts.paths) ? artifacts.paths : [];
      artifactPaths.forEach((item) => pushPath(item));
    }
  });
  return out;
}

function buildFidelityEvidenceSnapshot(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const existing = asSafeObject(payload.fidelity_evidence);
  const connectionContext = normalizeConnectionContext(payload.connection_context);
  const fidelityEnvironment = normalizeFidelityEnvironment(payload.fidelity_environment);
  const captureRequest = asSafeObject(payload.capture_request);
  const captureResult = asSafeObject(payload.capture_result);
  const structureDiff = asSafeObject(payload.structure_diff) || asSafeObject(payload.figma_structure_diff);
  const visualDiff = asSafeObject(payload.visual_diff) || asSafeObject(payload.figma_visual_diff);
  const behaviorDiff = asSafeObject(payload.behavior_diff);
  const executionDiff = asSafeObject(payload.execution_diff);
  const phase4Score = asSafeObject(payload.phase4_score) || asSafeObject(payload.phase4_fidelity_score);
  const externalOperations = ensureRunExternalOperations(payload);
  const fidelityReasons = buildFidelityReasonSnapshot(payload);

  const structureRate = toNumberOrNull(asSafeObject(structureDiff && structureDiff.structural_reproduction)?.rate);
  const structureScore = structureRate === null ? null : Number((structureRate * 100).toFixed(2));
  const visualScore = toNumberOrNull(visualDiff && visualDiff.score);
  const behaviorScore = toNumberOrNull(behaviorDiff && behaviorDiff.score);
  const executionScore = toNumberOrNull(executionDiff && executionDiff.score);
  const finalScore =
    toNumberOrNull(phase4Score && phase4Score.final_score) ||
    toNumberOrNull(payload.fidelity_score) ||
    null;
  const artifacts = collectFidelityArtifactPaths(captureResult, externalOperations);

  const hasData = Boolean(
    (connectionContext && connectionContext.figma && connectionContext.figma.file_key) ||
      fidelityEnvironment ||
      captureRequest ||
      captureResult ||
      structureDiff ||
      visualDiff ||
      behaviorDiff ||
      executionDiff ||
      phase4Score ||
      (fidelityReasons && fidelityReasons.counts && fidelityReasons.counts.total > 0) ||
      artifacts.length > 0
  );
  if (!hasData) {
    return existing || null;
  }

  const figma = asSafeObject(connectionContext && connectionContext.figma);
  const target = asSafeObject(figma && figma.target);
  const comparisonTarget = asSafeObject(figma && figma.comparison_target);

  return {
    version: "phase4-fidelity-evidence-v1",
    figma_target: {
      file_key: typeof (figma && figma.file_key) === "string" ? figma.file_key : "",
      page_id: typeof (target && target.page_id) === "string" ? target.page_id : "",
      page_name: typeof (target && target.page_name) === "string" ? target.page_name : "",
      frame_id: typeof (target && target.frame_id) === "string" ? target.frame_id : "",
      frame_name: typeof (target && target.frame_name) === "string" ? target.frame_name : "",
      node_ids: Array.isArray(target && target.node_ids) ? target.node_ids : [],
      comparison_target: {
        id: typeof (comparisonTarget && comparisonTarget.id) === "string" ? comparisonTarget.id : "",
        mode: typeof (comparisonTarget && comparisonTarget.mode) === "string" ? comparisonTarget.mode : "",
      },
    },
    environment: fidelityEnvironment,
    capture: {
      request: captureRequest,
      result: captureResult,
    },
    diff_scores: {
      structure: {
        score: structureScore,
        threshold: toNumberOrNull(structureDiff && structureDiff.threshold),
        status:
          structureDiff && structureDiff.structural_reproduction && typeof structureDiff.structural_reproduction.status === "string"
            ? structureDiff.structural_reproduction.status
            : null,
      },
      visual: {
        score: visualScore,
        threshold: toNumberOrNull(visualDiff && visualDiff.threshold),
        status: visualDiff && typeof visualDiff.status === "string" ? visualDiff.status : null,
      },
      behavior: {
        score: behaviorScore,
        threshold: toNumberOrNull(behaviorDiff && behaviorDiff.threshold),
        status: behaviorDiff && typeof behaviorDiff.status === "string" ? behaviorDiff.status : null,
      },
      execution: {
        score: executionScore,
        threshold: toNumberOrNull(executionDiff && executionDiff.threshold),
        status: executionDiff && typeof executionDiff.status === "string" ? executionDiff.status : null,
      },
      final: {
        score: finalScore,
        threshold: toNumberOrNull((phase4Score && phase4Score.threshold) || payload.fidelity_threshold),
        status:
          (phase4Score && typeof phase4Score.status === "string" ? phase4Score.status : null) ||
          (typeof payload.fidelity_status === "string" ? payload.fidelity_status : null),
      },
    },
    diff_reasons: fidelityReasons,
    artifacts: {
      paths: artifacts,
      count: artifacts.length,
    },
    updated_at: new Date().toISOString(),
  };
}

function extractRunContextUsed(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const legacyContext = payload.context_used && typeof payload.context_used === "object" ? payload.context_used : {};
  const shared = legacyContext.shared_environment || payload.shared_environment;
  const connection = legacyContext.connection_context || payload.connection_context;
  const fidelityEnvironment = legacyContext.fidelity_environment || payload.fidelity_environment;
  const behaviorDiff =
    (legacyContext.behavior_diff && typeof legacyContext.behavior_diff === "object"
      ? legacyContext.behavior_diff
      : null) ||
    (payload.behavior_diff && typeof payload.behavior_diff === "object" ? payload.behavior_diff : null);
  const executionDiff =
    (legacyContext.execution_diff && typeof legacyContext.execution_diff === "object"
      ? legacyContext.execution_diff
      : null) ||
    (payload.execution_diff && typeof payload.execution_diff === "object" ? payload.execution_diff : null);
  const captureRequest =
    (legacyContext.capture_request && typeof legacyContext.capture_request === "object"
      ? legacyContext.capture_request
      : null) ||
    (payload.capture_request && typeof payload.capture_request === "object" ? payload.capture_request : null);
  const captureResult =
    (legacyContext.capture_result && typeof legacyContext.capture_result === "object"
      ? legacyContext.capture_result
      : null) ||
    (payload.capture_result && typeof payload.capture_result === "object" ? payload.capture_result : null);
  const externalRefs =
    legacyContext.external_references_snapshot ||
    payload.external_references_snapshot ||
    buildExternalReferencesSnapshotFromConnection(normalizeConnectionContext(connection));
  const fidelityReasons =
    (legacyContext.fidelity_reasons && typeof legacyContext.fidelity_reasons === "object"
      ? legacyContext.fidelity_reasons
      : null) ||
    buildFidelityReasonSnapshot(payload);
  const fidelityEvidence =
    (legacyContext.fidelity_evidence && typeof legacyContext.fidelity_evidence === "object"
      ? legacyContext.fidelity_evidence
      : null) ||
    buildFidelityEvidenceSnapshot(payload);
  const correctiveActionPlan =
    (legacyContext.corrective_action_plan && typeof legacyContext.corrective_action_plan === "object"
      ? legacyContext.corrective_action_plan
      : null) ||
    (payload.corrective_action_plan && typeof payload.corrective_action_plan === "object"
      ? payload.corrective_action_plan
      : null);
  return {
    shared_environment: normalizeSharedEnvironment(shared),
    connection_context: normalizeConnectionContext(connection),
    fidelity_environment: normalizeFidelityEnvironment(fidelityEnvironment),
    behavior_diff: behaviorDiff,
    execution_diff: executionDiff,
    capture_request: captureRequest,
    capture_result: captureResult,
    fidelity_reasons: fidelityReasons,
    fidelity_evidence: fidelityEvidence,
    corrective_action_plan: correctiveActionPlan,
    external_references_snapshot: normalizeExternalReferencesSnapshot(externalRefs),
    external_operations: ensureRunExternalOperations(payload),
    planned_actions: ensureRunPlannedActions(payload),
  };
}

function normalizeRunStatus(status) {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (raw === "completed") return RUN_STATUS.succeeded;
  if (raw === RUN_STATUS.queued || raw === RUN_STATUS.running || raw === RUN_STATUS.succeeded || raw === RUN_STATUS.failed) {
    return raw;
  }
  return RUN_STATUS.failed;
}

function normalizeFailureCode(status, failureCode) {
  if (status !== RUN_STATUS.failed) return null;
  const text = typeof failureCode === "string" ? failureCode.trim() : "";
  return text || "unknown_failure";
}

function resolveArtifacts(runId, targetPath) {
  const artifacts = [];
  if (targetPath && typeof targetPath === "string") {
    const normalizedTarget = targetPath.replace(/\{\{run_id\}\}/g, runId);
    const absolute = path.join(process.cwd(), normalizedTarget);
    if (fs.existsSync(absolute)) {
      artifacts.push(normalizedTarget);
    }
  }
  const logPath = `.ai-runs/${runId}/runner.log`;
  if (fs.existsSync(path.join(process.cwd(), logPath))) {
    artifacts.push(logPath);
  }
  return artifacts;
}

function listRuns(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
      .map((row) => {
        const parsedInputs = parseInputs(row.inputs_json);
        const retryMeta = extractRetryMetadata(parsedInputs);
        return {
          status: normalizeRunStatus(row.status),
          run_id: toPublicRunId(row.id),
          project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
          thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
          ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
          failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
          job_type: row.job_type || null,
          run_mode: row.run_mode || null,
          inputs: parsedInputs,
          context_used: extractRunContextUsed(parsedInputs),
          external_references_snapshot: ensureRunExternalReferencesSnapshot(parsedInputs),
          external_operations: ensureRunExternalOperations(parsedInputs),
          planned_actions: ensureRunPlannedActions(parsedInputs),
          figma_before_after: buildFigmaBeforeAfter(parsedInputs),
          external_audit: buildExternalAuditView({
            runId: toPublicRunId(row.id),
            projectId: row.project_id ? toPublicProjectId(row.project_id) : null,
            status: normalizeRunStatus(row.status),
            inputs: parsedInputs,
            externalOperations: ensureRunExternalOperations(parsedInputs),
            plannedActions: ensureRunPlannedActions(parsedInputs),
            figmaBeforeAfter: buildFigmaBeforeAfter(parsedInputs),
          }),
          target_path: row.target_path || null,
          artifacts: resolveArtifacts(row.id, row.target_path || null),
          figma_file_key: row.figma_file_key || null,
          ingest_artifact_path: row.ingest_artifact_path || null,
          github_pr_url: row.github_pr_url || null,
          github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
          retry_of_run_id: retryMeta.retry_of_run_id,
          retry_kind: retryMeta.retry_kind,
          retry_requested_at: retryMeta.retry_requested_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      })
  );
}

function listRunsByProject(db, projectId) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND project_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT, projectId)
      .map((row) => {
        const parsedInputs = parseInputs(row.inputs_json);
        const retryMeta = extractRetryMetadata(parsedInputs);
        return {
          status: normalizeRunStatus(row.status),
          run_id: toPublicRunId(row.id),
          project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
          thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
          ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
          failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
          job_type: row.job_type || null,
          run_mode: row.run_mode || null,
          inputs: parsedInputs,
          context_used: extractRunContextUsed(parsedInputs),
          external_references_snapshot: ensureRunExternalReferencesSnapshot(parsedInputs),
          external_operations: ensureRunExternalOperations(parsedInputs),
          planned_actions: ensureRunPlannedActions(parsedInputs),
          figma_before_after: buildFigmaBeforeAfter(parsedInputs),
          external_audit: buildExternalAuditView({
            runId: toPublicRunId(row.id),
            projectId: row.project_id ? toPublicProjectId(row.project_id) : null,
            status: normalizeRunStatus(row.status),
            inputs: parsedInputs,
            externalOperations: ensureRunExternalOperations(parsedInputs),
            plannedActions: ensureRunPlannedActions(parsedInputs),
            figmaBeforeAfter: buildFigmaBeforeAfter(parsedInputs),
          }),
          target_path: row.target_path || null,
          artifacts: resolveArtifacts(row.id, row.target_path || null),
          figma_file_key: row.figma_file_key || null,
          ingest_artifact_path: row.ingest_artifact_path || null,
          github_pr_url: row.github_pr_url || null,
          github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
          retry_of_run_id: retryMeta.retry_of_run_id,
          retry_kind: retryMeta.retry_kind,
          retry_requested_at: retryMeta.retry_requested_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      })
  );
}

function createRun(
  db,
  { job_type, run_mode, inputs, target_path, project_id = null, thread_id = null, ai_setting_id = null, figma_file_key = null, ingest_artifact_path = null }
) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  const inputPayload = inputs && typeof inputs === "object" ? inputs : {};
  const projectIdInput = project_id || inputPayload.project_id || null;
  const threadIdInput = thread_id || inputPayload.thread_id || null;
  const aiSettingIdInput = ai_setting_id || inputPayload.ai_setting_id || null;

  const projectResolved = isUuid(projectIdInput)
    ? { ok: true, internalId: projectIdInput }
    : parseTrackingId(KINDS.project, projectIdInput || "", { nullable: true });
  if (!projectResolved.ok) {
    throw new Error(projectResolved.message || "project_id format is invalid");
  }
  const threadResolved = parseTrackingId(KINDS.thread, threadIdInput, { nullable: true });
  if (!threadResolved.ok) {
    throw new Error(threadResolved.message || "thread_id format is invalid");
  }
  const aiResolved = parseTrackingId(KINDS.ai_setting, aiSettingIdInput, { nullable: true });
  if (!aiResolved.ok) {
    throw new Error(aiResolved.message || "ai_setting_id format is invalid");
  }

  const normalizedProjectId = projectResolved.internalId || API_RUNS_PROJECT_ID;
  const normalizedThreadId = threadResolved.internalId || null;
  const normalizedAiSettingId = aiResolved.internalId || null;
  const normalizedInputs = { ...inputPayload };
  if (normalizedProjectId && normalizedProjectId !== API_RUNS_PROJECT_ID) {
    normalizedInputs.project_id = toPublicProjectId(normalizedProjectId);
  }
  if (normalizedThreadId) {
    normalizedInputs.thread_id = toPublicThreadId(normalizedThreadId);
  }
  if (normalizedAiSettingId) {
    normalizedInputs.ai_setting_id = toPublicAiSettingId(normalizedAiSettingId);
  }
  const sharedEnvironment = normalizeSharedEnvironment(normalizedInputs.shared_environment);
  const connectionContext = normalizeConnectionContext(normalizedInputs.connection_context);
  const fidelityEnvironment = normalizeFidelityEnvironment(normalizedInputs.fidelity_environment);
  const externalReferencesSnapshot = ensureRunExternalReferencesSnapshot({
    ...normalizedInputs,
    connection_context: connectionContext,
  });
  const externalOperations = ensureRunExternalOperations(normalizedInputs);
  const plannedActions = ensureRunPlannedActions(normalizedInputs);
  const fidelityReasons = buildFidelityReasonSnapshot(normalizedInputs);
  const fidelityEvidence = buildFidelityEvidenceSnapshot({
    ...normalizedInputs,
    fidelity_reasons: fidelityReasons,
    external_operations: externalOperations,
  });
  normalizedInputs.shared_environment = sharedEnvironment;
  normalizedInputs.connection_context = connectionContext;
  normalizedInputs.fidelity_environment = fidelityEnvironment;
  normalizedInputs.external_references_snapshot = externalReferencesSnapshot;
  normalizedInputs.external_operations = externalOperations;
  normalizedInputs.planned_actions = plannedActions;
  if (fidelityReasons) {
    normalizedInputs.fidelity_reasons = fidelityReasons;
  }
  if (fidelityEvidence) {
    normalizedInputs.fidelity_evidence = fidelityEvidence;
  }
  normalizedInputs.context_used = {
    ...(normalizedInputs.context_used && typeof normalizedInputs.context_used === "object" ? normalizedInputs.context_used : {}),
    shared_environment: sharedEnvironment,
    connection_context: connectionContext,
    fidelity_environment: fidelityEnvironment,
    external_references_snapshot: externalReferencesSnapshot,
    external_operations: externalOperations,
    planned_actions: plannedActions,
    fidelity_reasons: fidelityReasons,
    fidelity_evidence: fidelityEvidence,
  };
  const inputsJson = JSON.stringify(normalizedInputs);
  const searchRequestedBy = extractSearchRequestedBy(normalizedInputs);
  const searchProvider = extractSearchProvider(normalizedInputs);
  withRetry(() =>
    db
      .prepare(
        "INSERT INTO runs(tenant_id,id,project_id,thread_id,ai_setting_id,status,inputs_json,job_type,run_mode,target_path,figma_file_key,ingest_artifact_path,search_requested_by,search_provider,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        DEFAULT_TENANT,
        runId,
        normalizedProjectId,
        normalizedThreadId,
        normalizedAiSettingId,
        "queued",
        inputsJson,
        job_type,
        run_mode || "mcp",
        target_path,
        figma_file_key,
        ingest_artifact_path,
        searchRequestedBy || null,
        searchProvider || null,
        ts,
        ts
      )
  );
  return runId;
}

function getRun(db, runId) {
  const row = withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) {
    return null;
  }
  const parsedInputs = parseInputs(row.inputs_json);
  const retryMeta = extractRetryMetadata(parsedInputs);
  return {
    status: normalizeRunStatus(row.status),
    run_id: toPublicRunId(row.id),
    project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
    thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
    ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
    failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
    job_type: row.job_type || null,
    run_mode: row.run_mode || null,
    inputs: parsedInputs,
    context_used: extractRunContextUsed(parsedInputs),
    external_references_snapshot: ensureRunExternalReferencesSnapshot(parsedInputs),
    external_operations: ensureRunExternalOperations(parsedInputs),
    planned_actions: ensureRunPlannedActions(parsedInputs),
    figma_before_after: buildFigmaBeforeAfter(parsedInputs),
    external_audit: buildExternalAuditView({
      runId: toPublicRunId(row.id),
      projectId: row.project_id ? toPublicProjectId(row.project_id) : null,
      status: normalizeRunStatus(row.status),
      inputs: parsedInputs,
      externalOperations: ensureRunExternalOperations(parsedInputs),
      plannedActions: ensureRunPlannedActions(parsedInputs),
      figmaBeforeAfter: buildFigmaBeforeAfter(parsedInputs),
    }),
    target_path: row.target_path || null,
    artifacts: resolveArtifacts(row.id, row.target_path || null),
    figma_file_key: row.figma_file_key || null,
    ingest_artifact_path: row.ingest_artifact_path || null,
    github_pr_url: row.github_pr_url || null,
    github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
    retry_of_run_id: retryMeta.retry_of_run_id,
    retry_kind: retryMeta.retry_kind,
    retry_requested_at: retryMeta.retry_requested_at,
    retry_children: listRetryChildren(db, row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function claimNextQueuedRun(db) {
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,job_type,run_mode,inputs_json,target_path,figma_file_key,ingest_artifact_path,created_at,updated_at FROM runs WHERE tenant_id=? AND status='queued' ORDER BY created_at ASC LIMIT 1"
      )
      .get(DEFAULT_TENANT);
    if (!row || !row.id) {
      return null;
    }
    const ts = nowIso();
    const changed = db
      .prepare(
        "UPDATE runs SET status='running', failure_code=NULL, updated_at=? WHERE tenant_id=? AND id=? AND status='queued'"
      )
      .run(ts, DEFAULT_TENANT, row.id).changes;
    if (changed < 1) {
      return null;
    }
    return {
      ...row,
      status: "running",
      updated_at: ts,
      failure_code: null,
    };
  });
  return withRetry(() => tx());
}

function markRunRunning(db, runId) {
  const ts = nowIso();
  const changes = withRetry(() =>
    db
      .prepare("UPDATE runs SET status='running', failure_code=NULL, updated_at=? WHERE tenant_id=? AND id=? AND status='queued'")
      .run(ts, DEFAULT_TENANT, runId).changes
  );
  return changes > 0;
}

function markRunFinished(db, runId, { status, failureCode = null }) {
  const normalizedStatus = normalizeRunStatus(status);
  if (normalizedStatus === RUN_STATUS.failed && (!failureCode || !String(failureCode).trim())) {
    throw new Error("failureCode is required when status=failed");
  }
  const normalizedFailure = normalizedStatus === RUN_STATUS.failed ? String(failureCode).trim() : null;
  const ts = nowIso();
  withRetry(() =>
    db
      .prepare("UPDATE runs SET status=?, failure_code=?, updated_at=? WHERE tenant_id=? AND id=? AND status='running'")
      .run(normalizedStatus, normalizedFailure, ts, DEFAULT_TENANT, runId)
  );
}

function appendRunExternalOperation(db, runId, operation) {
  if (!db || typeof db.prepare !== "function" || !runId) return false;
  const normalized = normalizeExternalOperationEntry(operation);
  if (!normalized) return false;
  const row = withRetry(() =>
    db
      .prepare("SELECT inputs_json FROM runs WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) return false;
  const parsedInputs = parseInputs(row.inputs_json);
  const current = ensureRunExternalOperations(parsedInputs);
  const next = [...current, normalized].slice(-200);
  const contextUsed = parsedInputs.context_used && typeof parsedInputs.context_used === "object" ? parsedInputs.context_used : {};
  const fidelityEvidence = buildFidelityEvidenceSnapshot({
    ...parsedInputs,
    external_operations: next,
  });
  const updatedInputs = {
    ...parsedInputs,
    external_operations: next,
    fidelity_evidence: fidelityEvidence,
    context_used: {
      ...contextUsed,
      external_operations: next,
      fidelity_evidence: fidelityEvidence,
    },
  };
  const searchRequestedBy = extractSearchRequestedBy(updatedInputs);
  const searchProvider = extractSearchProvider(updatedInputs);
  const changes = withRetry(() =>
    db
      .prepare("UPDATE runs SET inputs_json=?, search_requested_by=?, search_provider=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(updatedInputs), searchRequestedBy || null, searchProvider || null, nowIso(), DEFAULT_TENANT, runId).changes
  );
  return changes > 0;
}

function patchRunInputs(db, runId, patch = {}) {
  if (!db || typeof db.prepare !== "function" || !runId || !patch || typeof patch !== "object") return false;
  const row = withRetry(() =>
    db
      .prepare("SELECT inputs_json FROM runs WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) return false;
  const parsedInputs = parseInputs(row.inputs_json);
  const currentContextUsed =
    parsedInputs.context_used && typeof parsedInputs.context_used === "object" ? parsedInputs.context_used : {};
  const merged = {
    ...parsedInputs,
    ...patch,
  };
  const sharedEnvironment = normalizeSharedEnvironment(merged.shared_environment);
  const connectionContext = normalizeConnectionContext(merged.connection_context);
  const externalReferencesSnapshot = ensureRunExternalReferencesSnapshot({
    ...merged,
    connection_context: connectionContext,
  });
  const externalOperations = ensureRunExternalOperations(merged);
  const plannedActions = ensureRunPlannedActions(merged);
  const fidelityReasons = buildFidelityReasonSnapshot(merged);
  const fidelityEvidence = buildFidelityEvidenceSnapshot({
    ...merged,
    fidelity_reasons: fidelityReasons,
    external_operations: externalOperations,
  });
  const nextInputs = {
    ...merged,
    shared_environment: sharedEnvironment,
    connection_context: connectionContext,
    external_references_snapshot: externalReferencesSnapshot,
    external_operations: externalOperations,
    planned_actions: plannedActions,
    fidelity_reasons: fidelityReasons,
    fidelity_evidence: fidelityEvidence,
    context_used: {
      ...currentContextUsed,
      ...(merged.context_used && typeof merged.context_used === "object" ? merged.context_used : {}),
      shared_environment: sharedEnvironment,
      connection_context: connectionContext,
      external_references_snapshot: externalReferencesSnapshot,
      external_operations: externalOperations,
      planned_actions: plannedActions,
      fidelity_reasons: fidelityReasons,
      fidelity_evidence: fidelityEvidence,
    },
  };
  const searchRequestedBy = extractSearchRequestedBy(nextInputs);
  const searchProvider = extractSearchProvider(nextInputs);
  const changes = withRetry(() =>
    db
      .prepare("UPDATE runs SET inputs_json=?, search_requested_by=?, search_provider=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(nextInputs), searchRequestedBy || null, searchProvider || null, nowIso(), DEFAULT_TENANT, runId).changes
  );
  return changes > 0;
}

module.exports = {
  listRuns,
  listRunsByProject,
  getRun,
  createRun,
  normalizeExternalReferencesSnapshot,
  ensureRunExternalReferencesSnapshot,
  ensureRunExternalOperations,
  buildExternalAuditView,
  appendRunExternalOperation,
  patchRunInputs,
  hashConfirmToken,
  ensureRunPlannedActions,
  appendRunPlannedAction,
  confirmRunPlannedAction,
  extractRetryMetadata,
  toPublicRunId,
  parseRunIdInput,
  claimNextQueuedRun,
  markRunRunning,
  markRunFinished,
};
