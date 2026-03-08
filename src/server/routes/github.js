const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { createPullRequestMinimal } = require("../../github/pr");
const { updateRunTrace } = require("../../db/runTrace");
const {
  parseRunIdInput,
  appendRunExternalOperation,
  hashConfirmToken,
  appendRunPlannedAction,
  confirmRunPlannedAction,
  getRun,
} = require("../../api/runs");

function buildRepository(body) {
  return typeof body.owner === "string" && body.owner.trim() && typeof body.repo === "string" && body.repo.trim()
    ? `${body.owner.trim()}/${body.repo.trim()}`
    : "";
}

function normalizeOperationMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return "controlled_write";
  if (text === "read-only" || text === "read_only") return "read_only";
  if (text === "controlled-write" || text === "controlled_write") return "controlled_write";
  if (text === "disabled") return "disabled";
  return "controlled_write";
}

function parseAllowedBranches(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return [];
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function parseAllowedPaths(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim().replace(/^\/+/, "") : ""))
      .filter(Boolean)
      .slice(0, 200);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return [];
  return text
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+/, ""))
    .filter(Boolean)
    .slice(0, 200);
}

function isPathAllowed(path, allowedPrefixes) {
  const normalized = typeof path === "string" ? path.trim().replace(/^\/+/, "") : "";
  if (!normalized || !Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) return false;
  return allowedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function collectWritePaths(body = {}) {
  const list = [];
  if (Array.isArray(body.changes)) {
    for (const entry of body.changes) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.path !== "string") continue;
      const path = entry.path.trim().replace(/^\/+/, "");
      if (!path) continue;
      list.push(path);
    }
  }
  const filePath = typeof body.file_path === "string" ? body.file_path.trim().replace(/^\/+/, "") : "";
  if (filePath) list.push(filePath);
  return Array.from(new Set(list));
}

function matchesBranchRule(branch, rule) {
  if (!branch || !rule) return false;
  if (rule.endsWith("/*")) {
    const prefix = rule.slice(0, -1);
    return branch.startsWith(prefix);
  }
  return branch === rule;
}

async function handleGithubPrCreate(req, res, db) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", {
      failure_code: "validation_error",
    });
  }

  let internalRunId = "";
  try {
    const runIdInput = typeof body.run_id === "string" && body.run_id.trim() ? body.run_id.trim() : "";
    if (runIdInput) {
      const parsed = parseRunIdInput(runIdInput);
      if (!parsed.ok) {
        return jsonError(res, parsed.status || 400, parsed.code || "VALIDATION_ERROR", parsed.message || "run_id format is invalid", parsed.details || { failure_code: "validation_error" });
      }
      internalRunId = parsed.internalId;
    }
    const repository = buildRepository(body || {});
    const isDryRun = Boolean(body && body.dry_run);
    const confirm = Boolean(body && body.confirm);
    const plannedActionId = typeof body.planned_action_id === "string" ? body.planned_action_id.trim() : "";
    const confirmToken = typeof body.confirm_token === "string" ? body.confirm_token.trim() : "";
    const targetBranch = typeof body.head_branch === "string" ? body.head_branch.trim() : "";
    const createPr = body && body.create_pr !== undefined ? Boolean(body.create_pr) : false;

    if (!isDryRun) {
      if (!internalRunId) {
        return jsonError(res, 400, "VALIDATION_ERROR", "run_id is required for confirm-required write", {
          failure_code: "validation_error",
        });
      }
      const runDetail = getRun(db, internalRunId);
      if (!runDetail) {
        return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
      }
      const shared = runDetail.inputs?.shared_environment && typeof runDetail.inputs.shared_environment === "object"
        ? runDetail.inputs.shared_environment
        : {};
      const githubMode = normalizeOperationMode(shared.github_operation_mode);
      const allowedBranches = parseAllowedBranches(shared.github_allowed_branches);
      const writePaths = collectWritePaths(body || {});
      const explicitAllowlist = parseAllowedPaths(body.write_path_allowlist);
      const defaultPath = typeof shared.github_default_path === "string" ? shared.github_default_path.trim().replace(/^\/+/, "") : "";
      const readPaths = Array.isArray(runDetail.external_references_snapshot?.github?.resolved_target_paths)
        ? runDetail.external_references_snapshot.github.resolved_target_paths
            .map((entry) => (typeof entry === "string" ? entry.trim().replace(/^\/+/, "") : ""))
            .filter(Boolean)
        : [];
      const effectivePathScope =
        explicitAllowlist.length > 0 ? explicitAllowlist : defaultPath ? [defaultPath] : readPaths;
      if (githubMode === "disabled" || githubMode === "read_only") {
        appendRunExternalOperation(db, internalRunId, {
          provider: "github",
          operation_type: "github.create_pr",
          target: { repository, branch: targetBranch, path: typeof body.file_path === "string" ? body.file_path.trim() : "" },
          result: { status: "skipped", failure_code: "permission", reason: `github_mode_${githubMode}` },
          artifacts: { branch: targetBranch || null },
        });
        return jsonError(res, 403, "VALIDATION_ERROR", "github write is not allowed for this project", {
          failure_code: "permission",
          reason: `github_mode_${githubMode}`,
        });
      }
      if (writePaths.length === 0) {
        return jsonError(res, 400, "VALIDATION_ERROR", "file_path or changes.path is required", {
          failure_code: "validation_error",
        });
      }
      if (effectivePathScope.length === 0) {
        return jsonError(res, 400, "VALIDATION_ERROR", "write path scope is not configured", {
          failure_code: "validation_error",
          reason: "github_default_path_or_allowlist_required",
        });
      }
      const disallowed = writePaths.filter((path) => !isPathAllowed(path, effectivePathScope));
      if (disallowed.length > 0) {
        appendRunExternalOperation(db, internalRunId, {
          provider: "github",
          operation_type: "github.create_pr",
          target: { repository, branch: targetBranch, paths: writePaths },
          result: { status: "skipped", failure_code: "validation_error", reason: "path_outside_allowed_scope" },
          artifacts: { branch: targetBranch || null },
        });
        return jsonError(res, 400, "VALIDATION_ERROR", "write path is outside allowed scope", {
          failure_code: "validation_error",
          disallowed_paths: disallowed,
        });
      }
      if (allowedBranches.length > 0) {
        if (!targetBranch) {
          return jsonError(res, 400, "VALIDATION_ERROR", "head_branch is required when github_allowed_branches is set", {
            failure_code: "validation_error",
          });
        }
        const isAllowed = allowedBranches.some((rule) => matchesBranchRule(targetBranch, rule));
        if (!isAllowed) {
          appendRunExternalOperation(db, internalRunId, {
            provider: "github",
            operation_type: "github.create_pr",
            target: { repository, branch: targetBranch, path: typeof body.file_path === "string" ? body.file_path.trim() : "" },
            result: { status: "skipped", failure_code: "validation_error", reason: "branch_outside_allowed_scope" },
            artifacts: { branch: targetBranch || null },
          });
          return jsonError(res, 400, "VALIDATION_ERROR", "head_branch is outside github_allowed_branches", {
            failure_code: "validation_error",
          });
        }
      }
    }

    if (!isDryRun && !confirm) {
      const actionId = crypto.randomUUID();
      const rawToken = crypto.randomBytes(18).toString("hex");
      const planned = appendRunPlannedAction(db, internalRunId, {
        action_id: actionId,
        provider: "github",
        operation_type: "github.create_pr",
        target: {
          repository,
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : "",
          path: typeof body.file_path === "string" ? body.file_path.trim() : "",
        },
        confirm_token_hash: hashConfirmToken(rawToken),
        status: "confirm_required",
      });
      if (!planned) {
        return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
      }
      appendRunExternalOperation(db, internalRunId, {
        provider: "github",
        operation_type: "github.create_pr",
        target: {
          repository,
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : "",
          path: typeof body.file_path === "string" ? body.file_path.trim() : "",
        },
        result: {
          status: "skipped",
          failure_code: null,
          reason: "confirm_required",
        },
        artifacts: {
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : null,
        },
      });
      return sendJson(res, 202, {
        status: "confirm_required",
        planned_action: {
          action_id: planned.action_id,
          provider: planned.provider,
          operation_type: planned.operation_type,
          target: planned.target,
          requested_at: planned.requested_at,
          expires_at: planned.expires_at,
        },
        confirm_token: rawToken,
      });
    }

    if (!isDryRun && confirm) {
      if (!internalRunId || !plannedActionId || !confirmToken) {
        return jsonError(res, 400, "VALIDATION_ERROR", "run_id, planned_action_id and confirm_token are required", {
          failure_code: "validation_error",
        });
      }
      const confirmed = confirmRunPlannedAction(db, internalRunId, {
        actionId: plannedActionId,
        confirmToken,
        provider: "github",
        operationType: "github.create_pr",
      });
      if (!confirmed.ok) {
        return jsonError(res, 400, "VALIDATION_ERROR", confirmed.reason || "confirm failed", {
          failure_code: confirmed.failure_code || "validation_error",
        });
      }
    }

    const result = await createPullRequestMinimal({
      ...(body || {}),
      create_pr: createPr,
    });
    if (internalRunId) {
      appendRunExternalOperation(db, internalRunId, {
        provider: "github",
        operation_type: "github.create_pr",
        target: {
          repository:
            typeof body.owner === "string" && body.owner.trim() && typeof body.repo === "string" && body.repo.trim()
              ? `${body.owner.trim()}/${body.repo.trim()}`
              : "",
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : "",
          path: typeof body.file_path === "string" ? body.file_path.trim() : "",
        },
        result: {
          status: result && result.dry_run ? "skipped" : "ok",
          failure_code: null,
          reason: result && result.dry_run ? "dry_run" : confirm ? "confirmed" : null,
        },
        artifacts: {
          commit_sha: result && typeof result.commit_sha === "string" ? result.commit_sha : null,
          branch: result && typeof result.head_branch === "string" ? result.head_branch : null,
          pr_url: result && typeof result.pr_url === "string" ? result.pr_url : null,
          pr_number: result && typeof result.pr_number === "number" ? result.pr_number : null,
          paths: Array.isArray(result?.committed_paths) ? result.committed_paths : [],
        },
      });
    }
    if (internalRunId && result && !result.dry_run) {
      updateRunTrace({
        runId: internalRunId,
        githubPrUrl: result.pr_url || null,
        githubPrNumber: result.pr_number || null,
      });
    }
    return sendJson(res, 201, result);
  } catch (error) {
    if (internalRunId) {
      appendRunExternalOperation(db, internalRunId, {
        provider: "github",
        operation_type: "github.create_pr",
        target: {
          repository:
            typeof body.owner === "string" && body.owner.trim() && typeof body.repo === "string" && body.repo.trim()
              ? `${body.owner.trim()}/${body.repo.trim()}`
              : "",
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : "",
          path: typeof body.file_path === "string" ? body.file_path.trim() : "",
        },
        result: {
          status: "error",
          failure_code: error.failure_code || "service_unavailable",
          reason: error.reason || error.message || "github pr failed",
        },
        artifacts: {
          branch: typeof body.head_branch === "string" ? body.head_branch.trim() : null,
        },
      });
    }
    return jsonError(res, error.status || 500, "VALIDATION_ERROR", error.message || "github pr failed", {
      failure_code: error.failure_code || "service_unavailable",
      reason: error.reason || null,
    });
  }
}

module.exports = {
  handleGithubPrCreate,
};
