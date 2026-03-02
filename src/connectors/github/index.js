const https = require("https");

const GITHUB_TOKEN_KEY = "github_token";

function normalizeGithubConfig(config = {}) {
  const token =
    typeof config[GITHUB_TOKEN_KEY] === "string"
      ? config[GITHUB_TOKEN_KEY].trim()
      : typeof config.token === "string"
        ? config.token.trim()
        : "";
  if (!token) {
    const error = new Error("github token is required");
    error.status = 400;
    error.failure_code = "validation_error";
    throw error;
  }
  return {
    [GITHUB_TOKEN_KEY]: token,
  };
}

function verifyGithubToken(token, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: "api.github.com",
        path: "/user",
        headers: {
          "User-Agent": "figma-ai-github-workflow",
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = {};
          try {
            payload = JSON.parse(text || "{}");
          } catch {
            payload = {};
          }
          const code = res.statusCode || 0;
          if (code >= 200 && code < 300) {
            resolve({ ok: true, login: payload.login || "", id: payload.id || null });
            return;
          }
          if (code === 401 || code === 403) {
            const error = new Error("github token verification failed");
            error.status = 401;
            error.failure_code = "permission";
            reject(error);
            return;
          }
          const error = new Error("github service unavailable");
          error.status = 503;
          error.failure_code = "service_unavailable";
          reject(error);
        });
      }
    );
    req.on("error", () => {
      const error = new Error("github service unavailable");
      error.status = 503;
      error.failure_code = "service_unavailable";
      reject(error);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("github verify timeout"));
    });
    req.end();
  });
}

module.exports = {
  GITHUB_TOKEN_KEY,
  normalizeGithubConfig,
  verifyGithubToken,
};
