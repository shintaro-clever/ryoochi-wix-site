function normalizePath(text) {
  return typeof text === "string" ? text.trim().replace(/^\/+/, "") : "";
}

function uniquePaths(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const path = normalizePath(item);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function normalizeChanges(body) {
  const source = Array.isArray(body?.changes) ? body.changes : [];
  if (source.length > 0) {
    return source
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const path = normalizePath(entry.path);
        if (!path) return null;
        const action = typeof entry.action === "string" ? entry.action.trim().toLowerCase() : "";
        const before = typeof entry.content_before === "string" ? entry.content_before : "";
        const after = typeof entry.content_after === "string" ? entry.content_after : "";
        let changeType = "update";
        if (action === "create" || action === "update" || action === "delete") {
          changeType = action;
        } else if (!before && after) {
          changeType = "create";
        } else if (before && !after) {
          changeType = "delete";
        }
        return { path, change_type: changeType, content_before: before, content_after: after };
      })
      .filter(Boolean)
      .slice(0, 200);
  }
  const filePath = normalizePath(body?.file_path);
  if (!filePath) return [];
  const fileContent = typeof body?.file_content === "string" ? body.file_content : "";
  return [{ path: filePath, change_type: "update", content_before: "", content_after: fileContent }];
}

function summarizeDiff(change) {
  const before = typeof change.content_before === "string" ? change.content_before : "";
  const after = typeof change.content_after === "string" ? change.content_after : "";
  const beforeLines = before.length > 0 ? before.split(/\r?\n/).length : 0;
  const afterLines = after.length > 0 ? after.split(/\r?\n/).length : 0;
  const delta = afterLines - beforeLines;
  const direction = delta === 0 ? "0 line change" : delta > 0 ? `+${delta} lines` : `${delta} lines`;
  return {
    before_lines: beforeLines,
    after_lines: afterLines,
    line_delta: delta,
    summary: `${change.change_type} ${change.path} (${direction})`,
  };
}

function buildGithubWritePlan({ body = {}, run = {} } = {}) {
  const changes = normalizeChanges(body);
  const shared = run.inputs?.shared_environment && typeof run.inputs.shared_environment === "object"
    ? run.inputs.shared_environment
    : {};
  const githubCtx = run.inputs?.connection_context?.github && typeof run.inputs.connection_context.github === "object"
    ? run.inputs.connection_context.github
    : {};
  const repository = typeof shared.github_repository === "string" && shared.github_repository.trim()
    ? shared.github_repository.trim()
    : typeof githubCtx?.repository_metadata?.full_name === "string"
      ? githubCtx.repository_metadata.full_name.trim()
      : "";
  const targetBranch = typeof body.head_branch === "string" && body.head_branch.trim()
    ? body.head_branch.trim()
    : typeof shared.github_default_branch === "string" && shared.github_default_branch.trim()
      ? shared.github_default_branch.trim()
      : typeof githubCtx.branch === "string" && githubCtx.branch.trim()
        ? githubCtx.branch.trim()
        : "main";

  const readPaths = uniquePaths(
    run.external_references_snapshot?.github?.resolved_target_paths ||
      run.external_references_snapshot?.github?.file_paths ||
      githubCtx.file_paths
  );
  const writePaths = uniquePaths(changes.map((item) => item.path));
  const pathMatch = writePaths.length > 0 && writePaths.every((path) => readPaths.includes(path)) ? "match" : "mismatch";
  const changePlan = changes.map((item) => ({ ...item, diff_summary: summarizeDiff(item) }));
  return {
    operation_type: "github.create_pr",
    repository,
    target_branch: targetBranch,
    read_path: readPaths[0] || "",
    write_path: writePaths[0] || "",
    read_paths: readPaths,
    write_paths: writePaths,
    path_match: pathMatch,
    changes: changePlan,
    expected_artifacts: {
      branch: targetBranch,
      commit: "planned",
      pull_request: "optional",
    },
    confirm_required_reason: "external write requires explicit confirmation",
  };
}

module.exports = {
  buildGithubWritePlan,
};
