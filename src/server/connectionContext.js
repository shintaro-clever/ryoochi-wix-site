const { readGithubRepository } = require("../integrations/github/client");
const { readFigmaFile } = require("../integrations/figma/client");

function normalizeFilePaths(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/^\/+/, "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function isValidGithubRef(ref) {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) return true;
  if (text.length > 200) return false;
  if (/\s/.test(text)) return false;
  if (text.includes("..") || text.startsWith("/") || text.includes("//")) return false;
  return /^[A-Za-z0-9._\/-]+$/.test(text);
}

function isValidGithubPath(path) {
  const text = typeof path === "string" ? path.trim() : "";
  if (!text) return false;
  if (text.length > 400) return false;
  if (text.includes("..") || text.includes("*") || text.includes("?")) return false;
  return true;
}

function validationError(message) {
  const err = new Error(message || "validation failed");
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function resolveGithubTargetSelection({
  projectDefaultBranch = "",
  projectDefaultPath = "",
  runOverrideRef = "",
  runOverrideFilePaths = [],
  readFilePath = "",
  readTreePath = "",
  mode = "context",
} = {}) {
  const refCandidate = (typeof runOverrideRef === "string" ? runOverrideRef.trim() : "") ||
    (typeof projectDefaultBranch === "string" ? projectDefaultBranch.trim() : "");
  if (refCandidate && !isValidGithubRef(refCandidate)) {
    throw validationError("github_ref is invalid");
  }

  const defaultPath = typeof projectDefaultPath === "string" ? projectDefaultPath.trim() : "";
  const normalizedOverridePaths = normalizeFilePaths(runOverrideFilePaths);
  const hasReadFilePath = typeof readFilePath === "string" && readFilePath.trim().length > 0;
  const hasReadTreePath = typeof readTreePath === "string" && readTreePath.trim().length > 0;
  if (mode === "read" && hasReadFilePath && hasReadTreePath) {
    throw validationError("ambiguous target: file_path and tree_path cannot be used together");
  }

  if (mode === "read") {
    if (hasReadFilePath && !isValidGithubPath(readFilePath)) {
      throw validationError("file_path is invalid");
    }
    if (hasReadTreePath && !isValidGithubPath(readTreePath)) {
      throw validationError("tree_path is invalid");
    }
    return {
      branch: refCandidate,
      filePath: hasReadFilePath ? readFilePath.trim().replace(/^\/+/, "") : "",
      treePath: hasReadTreePath ? readTreePath.trim().replace(/^\/+/, "") : "",
      resolvedPathMode: hasReadFilePath ? "file" : hasReadTreePath ? "tree" : "none",
      source: {
        branch: runOverrideRef ? "run_override" : projectDefaultBranch ? "project_default" : "repository_default",
        path: hasReadFilePath || hasReadTreePath ? "run_override" : "none",
      },
    };
  }

  if (normalizedOverridePaths.some((item) => !isValidGithubPath(item))) {
    throw validationError("github_file_paths contains invalid path");
  }
  if (defaultPath && !isValidGithubPath(defaultPath)) {
    throw validationError("github_default_path is invalid");
  }
  const filePaths = normalizedOverridePaths.length > 0
    ? normalizedOverridePaths
    : defaultPath
      ? [defaultPath.replace(/^\/+/, "")]
      : [];
  return {
    branch: refCandidate,
    filePaths,
    source: {
      branch: runOverrideRef ? "run_override" : projectDefaultBranch ? "project_default" : "repository_default",
      path: normalizedOverridePaths.length > 0 ? "run_override" : defaultPath ? "project_default" : "none",
    },
  };
}

function buildGithubHtmlUrl(repository) {
  const text = typeof repository === "string" ? repository.trim() : "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    return "";
  }
  return `https://github.com/${text}`;
}

function canResolveGithubRead(secretId) {
  const ref = typeof secretId === "string" ? secretId.trim() : "";
  if (ref.startsWith("env://")) return true;
  if (ref) return false;
  return typeof process.env.GITHUB_TOKEN === "string" && process.env.GITHUB_TOKEN.trim().length > 0;
}

function canResolveFigmaRead(secretId) {
  const ref = typeof secretId === "string" ? secretId.trim() : "";
  if (ref.startsWith("env://")) return true;
  if (ref) return false;
  return typeof process.env.FIGMA_TOKEN === "string" && process.env.FIGMA_TOKEN.trim().length > 0;
}

function parseFigmaScope(scope, kind) {
  const text = typeof scope === "string" ? scope.trim() : "";
  if (!text) return { id: "", name: "" };
  const idPrefix = `${kind}_id:`;
  const namePrefix = `${kind}:`;
  if (text.startsWith(idPrefix)) {
    return { id: text.slice(idPrefix.length).trim(), name: "" };
  }
  if (text.startsWith(namePrefix)) {
    return { id: "", name: text.slice(namePrefix.length).trim() };
  }
  return { id: "", name: text };
}

function normalizeNodeIds(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeFigmaWritableScope(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return "";
  if (text === "readonly" || text === "read-only") {
    return "read_only";
  }
  return text;
}

function resolveFigmaTargetSelection({
  projectPageScope = "",
  projectFrameScope = "",
  projectWritableScope = "",
  runPageScope = "",
  runFrameScope = "",
  runWritableScope = "",
  runNodeIds = [],
  readPageId = "",
  readPageName = "",
  readFrameId = "",
  readFrameName = "",
  readNodeId = "",
  readNodeIds = [],
  mode = "context",
} = {}) {
  const hasReadNodeId = typeof readNodeId === "string" && readNodeId.trim().length > 0;
  const normalizedReadNodeIds = normalizeNodeIds(readNodeIds);
  if (hasReadNodeId && normalizedReadNodeIds.length > 0) {
    throw validationError("ambiguous target: node_id and node_ids cannot be used together");
  }

  if (mode === "read") {
    const readPageIdText = typeof readPageId === "string" ? readPageId.trim() : "";
    const readPageNameText = typeof readPageName === "string" ? readPageName.trim() : "";
    const readFrameIdText = typeof readFrameId === "string" ? readFrameId.trim() : "";
    const readFrameNameText = typeof readFrameName === "string" ? readFrameName.trim() : "";
    const defaultPage = parseFigmaScope(projectPageScope, "page");
    const defaultFrame = parseFigmaScope(projectFrameScope, "frame");
    const pageId = readPageIdText || (!readPageNameText ? defaultPage.id : "");
    const pageName = readPageNameText || (!readPageIdText ? defaultPage.name : "");
    const frameId = readFrameIdText || (!readFrameNameText ? defaultFrame.id : "");
    const frameName = readFrameNameText || (!readFrameIdText ? defaultFrame.name : "");
    const nodeIds = hasReadNodeId ? [readNodeId.trim()] : normalizedReadNodeIds;
    if (pageId && pageName) {
      throw validationError("ambiguous target: page_id and page_name cannot be used together");
    }
    if (frameId && frameName) {
      throw validationError("ambiguous target: frame_id and frame_name cannot be used together");
    }
    if (!frameId && frameName && !pageId && !pageName) {
      throw validationError("frame_name requires page_id or page_name");
    }
    return {
      page: { id: pageId, name: pageName },
      frame: { id: frameId, name: frameName },
      nodeIds,
      writableScope: normalizeFigmaWritableScope(runWritableScope || projectWritableScope),
      source: {
        page: readPageIdText || readPageNameText ? "run_override" : pageId || pageName ? "project_default" : "none",
        frame:
          readFrameIdText || readFrameNameText ? "run_override" : frameId || frameName ? "project_default" : "none",
        nodes: nodeIds.length > 0 ? "run_override" : "none",
        writable_scope: runWritableScope ? "run_override" : projectWritableScope ? "project_default" : "none",
      },
    };
  }

  const pageScope = typeof runPageScope === "string" && runPageScope.trim() ? runPageScope.trim() : projectPageScope;
  const frameScope = typeof runFrameScope === "string" && runFrameScope.trim() ? runFrameScope.trim() : projectFrameScope;
  const page = parseFigmaScope(pageScope, "page");
  const frame = parseFigmaScope(frameScope, "frame");
  const nodeIds = normalizeNodeIds(runNodeIds);
  if (!frame.id && frame.name && !page.id && !page.name) {
    throw validationError("figma_frame_scope requires figma_page_scope");
  }
  return {
    page,
    frame,
    nodeIds,
    writableScope: normalizeFigmaWritableScope(
      (typeof runWritableScope === "string" && runWritableScope.trim() ? runWritableScope.trim() : "") || projectWritableScope
    ),
    source: {
      page: runPageScope ? "run_override" : projectPageScope ? "project_default" : "none",
      frame: runFrameScope ? "run_override" : projectFrameScope ? "project_default" : "none",
      nodes: nodeIds.length > 0 ? "run_override" : "none",
      writable_scope: runWritableScope ? "run_override" : projectWritableScope ? "project_default" : "none",
    },
  };
}

function buildFigmaWriteGuard({ writableScope = "", target = {} } = {}) {
  const scope = normalizeFigmaWritableScope(writableScope);
  const pageId = typeof target.page_id === "string" ? target.page_id.trim() : "";
  const frameId = typeof target.frame_id === "string" ? target.frame_id.trim() : "";
  const nodeIds = Array.isArray(target.node_ids) ? target.node_ids.filter((v) => typeof v === "string" && v.trim()) : [];
  if (!scope || scope === "read_only") {
    return { writable_scope: scope || "read_only", requires_confirmation: true, reason: "read_only_scope" };
  }
  if (scope === "file") {
    return { writable_scope: scope, requires_confirmation: false, reason: null };
  }
  if (scope === "page") {
    return {
      writable_scope: scope,
      requires_confirmation: !pageId,
      reason: pageId ? null : "writable_scope_page_requires_page_target",
    };
  }
  if (scope === "frame") {
    return {
      writable_scope: scope,
      requires_confirmation: !frameId,
      reason: frameId ? null : "writable_scope_frame_requires_frame_target",
    };
  }
  if (scope === "node") {
    return {
      writable_scope: scope,
      requires_confirmation: nodeIds.length === 0,
      reason: nodeIds.length > 0 ? null : "writable_scope_node_requires_node_target",
    };
  }
  return { writable_scope: scope, requires_confirmation: true, reason: "unknown_writable_scope" };
}

function summarizeFigmaNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.slice(0, 200).map((node) => ({
    id: typeof node?.id === "string" ? node.id : "",
    type: typeof node?.type === "string" ? node.type : "",
    name: typeof node?.name === "string" ? node.name : "",
    parent_id: typeof node?.parent_id === "string" ? node.parent_id : null,
    text_preview:
      typeof node?.text === "string" && node.text
        ? node.text.slice(0, 120)
        : null,
    component_kind: typeof node?.component?.kind === "string" ? node.component.kind : "none",
    auto_layout: {
      layout_mode: typeof node?.auto_layout?.layout_mode === "string" ? node.auto_layout.layout_mode : null,
      primary_axis_sizing_mode:
        typeof node?.auto_layout?.primary_axis_sizing_mode === "string"
          ? node.auto_layout.primary_axis_sizing_mode
          : null,
      counter_axis_sizing_mode:
        typeof node?.auto_layout?.counter_axis_sizing_mode === "string"
          ? node.auto_layout.counter_axis_sizing_mode
          : null,
    },
    sizing_spacing: {
      width: typeof node?.sizing_spacing?.width === "number" ? node.sizing_spacing.width : null,
      height: typeof node?.sizing_spacing?.height === "number" ? node.sizing_spacing.height : null,
      item_spacing:
        typeof node?.sizing_spacing?.item_spacing === "number" ? node.sizing_spacing.item_spacing : null,
      padding: node?.sizing_spacing?.padding && typeof node.sizing_spacing.padding === "object"
        ? {
            left: typeof node.sizing_spacing.padding.left === "number" ? node.sizing_spacing.padding.left : null,
            right: typeof node.sizing_spacing.padding.right === "number" ? node.sizing_spacing.padding.right : null,
            top: typeof node.sizing_spacing.padding.top === "number" ? node.sizing_spacing.padding.top : null,
            bottom: typeof node.sizing_spacing.padding.bottom === "number" ? node.sizing_spacing.padding.bottom : null,
          }
        : { left: null, right: null, top: null, bottom: null },
    },
  }));
}

async function buildGithubConnectionContext({
  sharedEnvironment = {},
  filePaths = [],
  ref = "",
} = {}) {
  const repository = typeof sharedEnvironment.github_repository === "string" ? sharedEnvironment.github_repository.trim() : "";
  if (!repository) {
    return null;
  }
  const configuredDefaultBranch =
    typeof sharedEnvironment.github_default_branch === "string" ? sharedEnvironment.github_default_branch.trim() : "";
  const configuredDefaultPath =
    typeof sharedEnvironment.github_default_path === "string" ? sharedEnvironment.github_default_path.trim() : "";
  const secretId = typeof sharedEnvironment.github_secret_id === "string" ? sharedEnvironment.github_secret_id.trim() : "";
  const selection = resolveGithubTargetSelection({
    projectDefaultBranch: configuredDefaultBranch,
    projectDefaultPath: configuredDefaultPath,
    runOverrideRef: ref,
    runOverrideFilePaths: filePaths,
    mode: "context",
  });

  const base = {
    provider: "github",
    status: "skipped",
    branch: selection.branch,
    latest_commit_sha: "",
    file_paths: selection.filePaths,
    selection_source: selection.source,
    repository_metadata: {
      full_name: repository,
      default_branch: configuredDefaultBranch || "",
      private: null,
      html_url: buildGithubHtmlUrl(repository),
    },
  };

  if (!canResolveGithubRead(secretId)) {
    return base;
  }

  try {
    const read = await readGithubRepository({
      repository,
      defaultBranch: configuredDefaultBranch,
      secretId,
      ref: selection.branch,
    });
    return {
      ...base,
      status: "ok",
      branch: read.branch || selection.branch || base.branch,
      latest_commit_sha: read.latest_commit?.sha || "",
      repository_metadata: {
        full_name: read.repository?.full_name || base.repository_metadata.full_name,
        default_branch: read.repository?.default_branch || base.repository_metadata.default_branch,
        private: typeof read.repository?.private === "boolean" ? read.repository.private : base.repository_metadata.private,
        html_url: read.repository?.html_url || base.repository_metadata.html_url,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      error: {
        code: error.code || "INTEGRATION_ERROR",
        failure_code: error.failure_code || "integration_error",
        reason: error.reason || "service_unavailable",
        message: error.message || "github read failed",
      },
    };
  }
}

async function buildFigmaConnectionContext({
  sharedEnvironment = {},
  pageScope = "",
  frameScope = "",
  nodeIds = [],
  writableScope = "",
} = {}) {
  const figmaFileKey = typeof sharedEnvironment.figma_file_key === "string" ? sharedEnvironment.figma_file_key.trim() : "";
  const figmaFile = typeof sharedEnvironment.figma_file === "string" ? sharedEnvironment.figma_file.trim() : "";
  if (!figmaFileKey && !figmaFile) {
    return null;
  }
  const secretId = typeof sharedEnvironment.figma_secret_id === "string" ? sharedEnvironment.figma_secret_id.trim() : "";
  const selection = resolveFigmaTargetSelection({
    projectPageScope: typeof sharedEnvironment.figma_page_scope === "string" ? sharedEnvironment.figma_page_scope.trim() : "",
    projectFrameScope: typeof sharedEnvironment.figma_frame_scope === "string" ? sharedEnvironment.figma_frame_scope.trim() : "",
    projectWritableScope:
      typeof sharedEnvironment.figma_writable_scope === "string" ? sharedEnvironment.figma_writable_scope.trim() : "",
    runPageScope: typeof pageScope === "string" ? pageScope.trim() : "",
    runFrameScope: typeof frameScope === "string" ? frameScope.trim() : "",
    runWritableScope: typeof writableScope === "string" ? writableScope.trim() : "",
    runNodeIds: nodeIds,
    mode: "context",
  });

  const base = {
    provider: "figma",
    status: "skipped",
    file_key: figmaFileKey,
    last_modified: "",
    target: {
      page_id: selection.page.id || "",
      page_name: selection.page.name || "",
      frame_id: selection.frame.id || "",
      frame_name: selection.frame.name || "",
      node_ids: selection.nodeIds,
    },
    target_selection_source: selection.source,
    writable_scope: selection.writableScope || "",
    write_guard: buildFigmaWriteGuard({
      writableScope: selection.writableScope || "",
      target: {
        page_id: selection.page.id || "",
        frame_id: selection.frame.id || "",
        node_ids: selection.nodeIds,
      },
    }),
    node_summaries: [],
    layout_summary: {
      node_count: 0,
      text_node_count: 0,
      component_node_count: 0,
      instance_node_count: 0,
      auto_layout_node_count: 0,
    },
  };

  if (!canResolveFigmaRead(secretId)) {
    return base;
  }

  try {
    const read = await readFigmaFile({
      figmaFile,
      figmaFileKey,
      secretId,
      pageId: selection.page.id,
      pageName: selection.page.name,
      frameId: selection.frame.id,
      frameName: selection.frame.name,
      nodeIds: selection.nodeIds,
    });
    const resolvedTarget = {
      page_id: read.target_resolution?.page?.id || "",
      page_name: read.target_resolution?.page?.name || "",
      frame_id: read.target_resolution?.frame?.id || "",
      frame_name: read.target_resolution?.frame?.name || "",
      node_ids: Array.isArray(read.target_resolution?.node_ids) ? read.target_resolution.node_ids : base.target.node_ids,
    };
    return {
      ...base,
      status: "ok",
      file_key: read.file_key || base.file_key || "",
      last_modified: read.file?.last_modified || "",
      target: resolvedTarget,
      write_guard: buildFigmaWriteGuard({ writableScope: selection.writableScope || "", target: resolvedTarget }),
      node_summaries: summarizeFigmaNodes(read.nodes),
      layout_summary: {
        node_count: typeof read.summary?.node_count === "number" ? read.summary.node_count : 0,
        text_node_count: typeof read.summary?.text_node_count === "number" ? read.summary.text_node_count : 0,
        component_node_count:
          typeof read.summary?.component_node_count === "number" ? read.summary.component_node_count : 0,
        instance_node_count:
          typeof read.summary?.instance_node_count === "number" ? read.summary.instance_node_count : 0,
        auto_layout_node_count:
          typeof read.summary?.auto_layout_node_count === "number" ? read.summary.auto_layout_node_count : 0,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      error: {
        code: error.code || "INTEGRATION_ERROR",
        failure_code: error.failure_code || "integration_error",
        reason: error.reason || "service_unavailable",
        message: error.message || "figma read failed",
      },
    };
  }
}

async function buildConnectionContext({
  sharedEnvironment = {},
  githubFilePaths = [],
  githubRef = "",
  figmaPageScope = "",
  figmaFrameScope = "",
  figmaNodeIds = [],
  figmaWritableScope = "",
} = {}) {
  const github = await buildGithubConnectionContext({
    sharedEnvironment,
    filePaths: githubFilePaths,
    ref: githubRef,
  });
  const figma = await buildFigmaConnectionContext({
    sharedEnvironment,
    pageScope: figmaPageScope,
    frameScope: figmaFrameScope,
    nodeIds: figmaNodeIds,
    writableScope: figmaWritableScope,
  });
  return {
    github,
    figma,
  };
}

module.exports = {
  normalizeFilePaths,
  resolveGithubTargetSelection,
  resolveFigmaTargetSelection,
  buildConnectionContext,
  buildGithubConnectionContext,
  buildFigmaConnectionContext,
};
