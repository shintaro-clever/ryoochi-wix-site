function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePathList(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const path = normalizeText(item).replace(/^\/+/, "");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function normalizeNodeIds(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const id = normalizeText(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function detectWriteIntent(content) {
  const text = normalizeText(content).toLowerCase();
  if (!text) return false;
  return /(?:update|write|delete|create|patch|commit|push|pr|変更|更新|書き込|修正|作成|削除)/i.test(text);
}

function detectProviderMention(content, key) {
  const text = normalizeText(content).toLowerCase();
  if (!text) return false;
  if (key === "github") {
    return /github|repo|repository|branch|path|file|コミット|ブランチ|リポジトリ|パス|ファイル/.test(text);
  }
  if (key === "figma") {
    return /figma|frame|node|page|auto layout|レイアウト|フレーム|ノード|ページ/.test(text);
  }
  return false;
}

function extractPathsFromContent(content) {
  const text = normalizeText(content);
  if (!text) return [];
  const matches = text.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) || [];
  const probable = matches.filter((item) => item.includes("/") && !item.includes("://"));
  return normalizePathList(probable);
}

function buildGithubReadPlan({ content = "", body = {}, sharedEnvironment = {}, connectionContext = {} } = {}) {
  const githubCtx = connectionContext.github && typeof connectionContext.github === "object" ? connectionContext.github : {};
  const configuredRepository = normalizeText(sharedEnvironment.github_repository);
  const repository =
    configuredRepository || normalizeText(githubCtx.repository_metadata && githubCtx.repository_metadata.full_name);
  const branch =
    normalizeText(body.github_ref) ||
    normalizeText(sharedEnvironment.github_default_branch) ||
    normalizeText(githubCtx.branch);
  const overridePaths = normalizePathList(Array.isArray(body.github_file_paths) ? body.github_file_paths : []);
  const contextPaths = normalizePathList(Array.isArray(githubCtx.file_paths) ? githubCtx.file_paths : []);
  const contentPaths = extractPathsFromContent(content);
  const defaultPath = normalizeText(sharedEnvironment.github_default_path).replace(/^\/+/, "");
  const readPaths =
    overridePaths.length > 0
      ? overridePaths
      : contentPaths.length > 0
        ? contentPaths
        : contextPaths.length > 0
          ? contextPaths
          : defaultPath
            ? [defaultPath]
            : [];
  const writeIntent = detectWriteIntent(content);
  const mentioned = detectProviderMention(content, "github");
  const shouldRead = Boolean(repository) && (mentioned || writeIntent || readPaths.length > 0);
  const ambiguityReasons = [];
  if (writeIntent && mentioned && readPaths.length === 0) {
    ambiguityReasons.push("ambiguous_github_path");
  }
  return {
    provider: "github",
    should_read: shouldRead,
    repository,
    branch,
    read_paths: readPaths,
    ambiguity_reasons: ambiguityReasons,
  };
}

function buildFigmaReadPlan({ content = "", body = {}, sharedEnvironment = {}, connectionContext = {} } = {}) {
  const figmaCtx = connectionContext.figma && typeof connectionContext.figma === "object" ? connectionContext.figma : {};
  const target = figmaCtx.target && typeof figmaCtx.target === "object" ? figmaCtx.target : {};
  const fileKey = normalizeText(sharedEnvironment.figma_file_key) || normalizeText(figmaCtx.file_key);
  const pageId = normalizeText(body.page_id) || normalizeText(target.page_id);
  const pageName = normalizeText(body.page_name) || normalizeText(target.page_name);
  const frameId = normalizeText(body.frame_id) || normalizeText(target.frame_id);
  const frameName = normalizeText(body.frame_name) || normalizeText(target.frame_name);
  const nodeIds = normalizeNodeIds(
    Array.isArray(body.node_ids)
      ? body.node_ids
      : Array.isArray(target.node_ids)
        ? target.node_ids
        : []
  );
  const writeIntent = detectWriteIntent(content);
  const mentioned = detectProviderMention(content, "figma");
  const shouldRead = Boolean(fileKey) && (mentioned || writeIntent || frameId || nodeIds.length > 0);
  const ambiguityReasons = [];
  if (writeIntent && mentioned && !frameId && nodeIds.length === 0) {
    ambiguityReasons.push("ambiguous_figma_target");
  }
  return {
    provider: "figma",
    should_read: shouldRead,
    file_key: fileKey,
    target: {
      page_id: pageId,
      page_name: pageName,
      frame_id: frameId,
      frame_name: frameName,
      node_ids: nodeIds,
    },
    ambiguity_reasons: ambiguityReasons,
  };
}

function buildExternalReadPlan({ content = "", body = {}, sharedEnvironment = {}, connectionContext = {} } = {}) {
  const writeIntent = detectWriteIntent(content);
  const github = buildGithubReadPlan({ content, body, sharedEnvironment, connectionContext });
  const figma = buildFigmaReadPlan({ content, body, sharedEnvironment, connectionContext });
  const ambiguityReasons = [...github.ambiguity_reasons, ...figma.ambiguity_reasons];
  const confirmRequired = ambiguityReasons.length > 0;
  return {
    status: "ok",
    write_intent: writeIntent,
    actionability: confirmRequired ? "confirm_required" : "ready",
    confirm_required: confirmRequired,
    confirm_required_reason: confirmRequired ? ambiguityReasons.join(",") : null,
    ambiguity_reasons: ambiguityReasons,
    read_targets: {
      github: github.should_read
        ? {
            repository: github.repository,
            branch: github.branch,
            paths: github.read_paths,
          }
        : null,
      figma: figma.should_read
        ? {
            file_key: figma.file_key,
            target: figma.target,
          }
        : null,
    },
    providers: {
      github,
      figma,
    },
  };
}

function buildChatAssistantGuardMessage(plan) {
  const payload = plan && typeof plan === "object" ? plan : {};
  if (!payload.confirm_required) return "";
  const reasons = Array.isArray(payload.ambiguity_reasons) ? payload.ambiguity_reasons.join(", ") : "ambiguous_target";
  const github = payload.read_targets && payload.read_targets.github ? payload.read_targets.github : null;
  const figma = payload.read_targets && payload.read_targets.figma ? payload.read_targets.figma : null;
  const githubLine = github
    ? `github read: repo=${github.repository || "-"} branch=${github.branch || "-"} paths=${Array.isArray(github.paths) ? github.paths.join("|") : "-"}`
    : "github read: -";
  const figmaLine = figma
    ? `figma read: file_key=${figma.file_key || "-"} page=${figma.target?.page_id || figma.target?.page_name || "-"} frame=${figma.target?.frame_id || figma.target?.frame_name || "-"} nodes=${Array.isArray(figma.target?.node_ids) ? figma.target.node_ids.length : 0}`
    : "figma read: -";
  return `confirm required: ambiguous external target (${reasons}). ${githubLine}. ${figmaLine}.`;
}

module.exports = {
  buildExternalReadPlan,
  buildChatAssistantGuardMessage,
};
