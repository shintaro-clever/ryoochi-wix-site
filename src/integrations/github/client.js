const https = require("https");

function integrationError(message, { status = 502, reason = "service_unavailable", providerStatus = null } = {}) {
  const err = new Error(message || "github integration failed");
  err.status = status;
  err.code = "INTEGRATION_ERROR";
  err.failure_code = "integration_error";
  err.reason = reason;
  err.provider_status = providerStatus;
  return err;
}

function validationError(message) {
  const err = new Error(message || "validation failed");
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function parseRepository(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const m = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) {
    throw validationError("github_repository is invalid");
  }
  return { owner: m[1], repo: m[2] };
}

function resolveGithubToken(secretId) {
  const ref = typeof secretId === "string" ? secretId.trim() : "";
  if (ref) {
    if (ref.startsWith("env://")) {
      const envName = ref.slice("env://".length).trim();
      if (!envName) {
        throw validationError("github_secret_id env reference is invalid");
      }
      const value = typeof process.env[envName] === "string" ? process.env[envName].trim() : "";
      if (!value) {
        throw validationError(`github secret env is missing: ${envName}`);
      }
      return value;
    }
    // Minimal implementation: only env:// references can be resolved locally.
    throw validationError("github_secret_id must be resolvable (use env://<ENV_NAME>)");
  }
  const fallback = typeof process.env.GITHUB_TOKEN === "string" ? process.env.GITHUB_TOKEN.trim() : "";
  if (!fallback) {
    throw validationError("github_secret_id is required or set GITHUB_TOKEN");
  }
  return fallback;
}

function requestGithub({ method = "GET", path, token, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: "api.github.com",
        method,
        path,
        headers: {
          "User-Agent": "figma-ai-github-workflow",
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const status = res.statusCode || 500;
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch {
              json = null;
            }
          }
          if (status >= 200 && status < 300) {
            return resolve({ status, json, raw });
          }
          if (status === 401 || status === 403) {
            return reject(
              integrationError("github permission denied", {
                status: 403,
                reason: "permission_denied",
                providerStatus: status,
              })
            );
          }
          if (status === 404) {
            return reject(
              integrationError("github resource not found", {
                status: 404,
                reason: "not_found",
                providerStatus: status,
              })
            );
          }
          return reject(
            integrationError("github service unavailable", {
              status: 502,
              reason: "service_unavailable",
              providerStatus: status,
            })
          );
        });
      }
    );
    req.on("error", () => {
      reject(integrationError("github service unavailable", { status: 503, reason: "service_unavailable" }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
      reject(integrationError("github request timeout", { status: 504, reason: "service_unavailable" }));
    });
    req.end();
  });
}

async function readGithubRepository({
  repository,
  defaultBranch = "",
  secretId = "",
  ref = "",
  filePath = "",
  treePath = "",
}) {
  const parsedRepo = parseRepository(repository);
  const token = resolveGithubToken(secretId);
  const repoMeta = await requestGithub({
    path: `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}`,
    token,
  });
  const branch = (typeof ref === "string" && ref.trim()) || defaultBranch || repoMeta.json?.default_branch || "main";
  const latestCommit = await requestGithub({
    path:
      `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}` +
      `/commits/${encodeURIComponent(branch)}`,
    token,
  });

  const result = {
    repository: {
      full_name: repoMeta.json?.full_name || `${parsedRepo.owner}/${parsedRepo.repo}`,
      default_branch: repoMeta.json?.default_branch || "",
      private: Boolean(repoMeta.json?.private),
      html_url: repoMeta.json?.html_url || "",
    },
    branch,
    latest_commit: {
      sha: latestCommit.json?.sha || "",
      message: latestCommit.json?.commit?.message || "",
      author_name: latestCommit.json?.commit?.author?.name || "",
      authored_at: latestCommit.json?.commit?.author?.date || "",
      html_url: latestCommit.json?.html_url || "",
    },
  };

  const normalizedTreePath = typeof treePath === "string" ? treePath.trim() : "";
  if (normalizedTreePath) {
    const treeShaResponse = await requestGithub({
      path:
        `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}` +
        `/contents/${normalizedTreePath}?ref=${encodeURIComponent(branch)}`,
      token,
    });
    const treeSha = treeShaResponse.json?.sha || "";
    if (!treeSha) {
      throw integrationError("github tree not found", { status: 404, reason: "not_found" });
    }
    const treeResponse = await requestGithub({
      path:
        `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}` +
        `/git/trees/${encodeURIComponent(treeSha)}`,
      token,
    });
    const entries = Array.isArray(treeResponse.json?.tree) ? treeResponse.json.tree : [];
    result.tree = {
      path: normalizedTreePath,
      entries: entries.map((entry) => ({
        path: entry.path || "",
        type: entry.type || "",
        sha: entry.sha || "",
        size: typeof entry.size === "number" ? entry.size : null,
      })),
    };
  }

  const normalizedFilePath = typeof filePath === "string" ? filePath.trim() : "";
  if (normalizedFilePath) {
    const fileResponse = await requestGithub({
      path:
        `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}` +
        `/contents/${normalizedFilePath}?ref=${encodeURIComponent(branch)}`,
      token,
    });
    const encoding = fileResponse.json?.encoding || "";
    const encoded = fileResponse.json?.content || "";
    let text = "";
    if (encoding === "base64" && typeof encoded === "string") {
      text = Buffer.from(encoded.replace(/\n/g, ""), "base64").toString("utf8");
    } else if (typeof encoded === "string") {
      text = encoded;
    }
    result.file = {
      path: normalizedFilePath,
      sha: fileResponse.json?.sha || "",
      size: typeof fileResponse.json?.size === "number" ? fileResponse.json.size : null,
      encoding,
      content: text,
    };
  }

  return result;
}

module.exports = {
  readGithubRepository,
  integrationError,
  validationError,
};
