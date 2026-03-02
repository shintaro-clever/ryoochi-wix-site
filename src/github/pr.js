const https = require("https");

function encodePath(path) {
  return String(path || "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function githubRequest({ token, method, path, body }) {
  return new Promise((resolve, reject) => {
    const rawBody = body ? JSON.stringify(body) : "";
    const req = https.request(
      {
        method,
        hostname: "api.github.com",
        path,
        headers: {
          "User-Agent": "figma-ai-github-workflow",
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          ...(rawBody ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = {};
          try {
            payload = text ? JSON.parse(text) : {};
          } catch {
            payload = { message: text };
          }
          resolve({ statusCode: res.statusCode || 0, payload });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("github request timeout")));
    if (rawBody) {
      req.write(rawBody);
    }
    req.end();
  });
}

function validatePayload(payload = {}) {
  const owner = typeof payload.owner === "string" ? payload.owner.trim() : "";
  const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
  const token = typeof payload.github_token === "string" ? payload.github_token.trim() : "";
  const baseBranch = typeof payload.base_branch === "string" && payload.base_branch.trim() ? payload.base_branch.trim() : "main";
  const headBranch =
    typeof payload.head_branch === "string" && payload.head_branch.trim()
      ? payload.head_branch.trim()
      : `hub/${Date.now()}`;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const prBody = typeof payload.body === "string" ? payload.body : "";
  const dryRun = Boolean(payload.dry_run);
  if (!owner || !repo || !title) {
    const error = new Error("owner, repo, title are required");
    error.status = 400;
    error.failure_code = "validation_error";
    throw error;
  }
  if (!dryRun && !token) {
    const error = new Error("github_token is required");
    error.status = 400;
    error.failure_code = "validation_error";
    throw error;
  }
  return {
    owner,
    repo,
    token,
    baseBranch,
    headBranch,
    title,
    prBody,
    dryRun,
    commitMessage:
      typeof payload.commit_message === "string" && payload.commit_message.trim()
        ? payload.commit_message.trim()
        : "Hub generated change",
    filePath:
      typeof payload.file_path === "string" && payload.file_path.trim()
        ? payload.file_path.trim()
        : "vault/tmp/hub-generated.txt",
    fileContent:
      typeof payload.file_content === "string" && payload.file_content.length > 0
        ? payload.file_content
        : `generated at ${new Date().toISOString()}`,
  };
}

async function createPullRequestMinimal(payload = {}) {
  const input = validatePayload(payload);
  if (input.dryRun) {
    return {
      dry_run: true,
      owner: input.owner,
      repo: input.repo,
      base_branch: input.baseBranch,
      head_branch: input.headBranch,
      title: input.title,
      status: "planned",
    };
  }

  try {
    const baseRef = await githubRequest({
      token: input.token,
      method: "GET",
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/ref/heads/${encodeURIComponent(
        input.baseBranch
      )}`,
    });
    if (baseRef.statusCode < 200 || baseRef.statusCode >= 300) {
      const error = new Error(baseRef.payload.message || "failed to fetch base branch");
      error.status = baseRef.statusCode === 401 || baseRef.statusCode === 403 ? 401 : 503;
      error.failure_code = error.status === 401 ? "permission" : "service_unavailable";
      throw error;
    }

    const baseSha = baseRef.payload && baseRef.payload.object ? baseRef.payload.object.sha : "";
    if (!baseSha) {
      const error = new Error("base branch sha not found");
      error.status = 503;
      error.failure_code = "service_unavailable";
      throw error;
    }

    const branchCreate = await githubRequest({
      token: input.token,
      method: "POST",
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`,
      body: {
        ref: `refs/heads/${input.headBranch}`,
        sha: baseSha,
      },
    });
    if (![201, 422].includes(branchCreate.statusCode)) {
      const error = new Error(branchCreate.payload.message || "failed to create branch");
      error.status = branchCreate.statusCode === 401 || branchCreate.statusCode === 403 ? 401 : 503;
      error.failure_code = error.status === 401 ? "permission" : "service_unavailable";
      throw error;
    }

    const contentCreate = await githubRequest({
      token: input.token,
      method: "PUT",
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodePath(input.filePath)}`,
      body: {
        message: input.commitMessage,
        content: Buffer.from(input.fileContent, "utf8").toString("base64"),
        branch: input.headBranch,
      },
    });
    if (contentCreate.statusCode < 200 || contentCreate.statusCode >= 300) {
      const error = new Error(contentCreate.payload.message || "failed to push commit");
      error.status = contentCreate.statusCode === 401 || contentCreate.statusCode === 403 ? 401 : 503;
      error.failure_code = error.status === 401 ? "permission" : "service_unavailable";
      throw error;
    }

    const prCreate = await githubRequest({
      token: input.token,
      method: "POST",
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
      body: {
        title: input.title,
        body: input.prBody,
        head: input.headBranch,
        base: input.baseBranch,
      },
    });
    if (prCreate.statusCode < 200 || prCreate.statusCode >= 300) {
      const error = new Error(prCreate.payload.message || "failed to create pull request");
      error.status = prCreate.statusCode === 401 || prCreate.statusCode === 403 ? 401 : 503;
      error.failure_code = error.status === 401 ? "permission" : "service_unavailable";
      throw error;
    }

    return {
      dry_run: false,
      status: "created",
      owner: input.owner,
      repo: input.repo,
      base_branch: input.baseBranch,
      head_branch: input.headBranch,
      pr_url: prCreate.payload.html_url || null,
      pr_number: typeof prCreate.payload.number === "number" ? prCreate.payload.number : null,
    };
  } catch (error) {
    if (error && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timeout/i.test(String(error.code || error.message || ""))) {
      const wrapped = new Error("network unavailable for github pr flow");
      wrapped.status = 503;
      wrapped.failure_code = "service_unavailable";
      wrapped.reason = "network_unavailable";
      throw wrapped;
    }
    throw error;
  }
}

module.exports = {
  createPullRequestMinimal,
};
