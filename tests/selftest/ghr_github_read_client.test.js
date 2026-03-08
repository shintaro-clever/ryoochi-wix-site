const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevReadToken = process.env.GH_READ_TOKEN;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.GH_READ_TOKEN = "ghu_read_dummy_token";

  const createdProjectIds = [];

  try {
    nock.disableNetConnect();
    nock.enableNetConnect("127.0.0.1");

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "gh-read-test", staging_url: "https://example.com" }),
    });
    assert(createRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public id");
    createdProjectIds.push(parsedProject.internalId);

    const putSettings = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        github_default_branch: "main",
        github_secret_id: "env://GH_READ_TOKEN",
      }),
    });
    assert(putSettings.statusCode === 200, "project settings put should return 200");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .reply(200, {
        full_name: "octocat/hello-world",
        default_branch: "main",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
      })
      .get("/repos/octocat/hello-world/commits/main")
      .reply(200, {
        sha: "sha-main-latest",
        html_url: "https://github.com/octocat/hello-world/commit/sha-main-latest",
        commit: {
          message: "latest commit",
          author: { name: "The Octocat", date: "2026-03-08T00:00:00Z" },
        },
      });
    const readBase = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(readBase.statusCode === 200, "github read base should return 200");
    const readBaseBody = JSON.parse(readBase.body.toString("utf8"));
    assert(readBaseBody.repository.full_name === "octocat/hello-world", "repository full_name should match");
    assert(readBaseBody.branch === "main", "branch should match project default branch");
    assert(readBaseBody.latest_commit.sha === "sha-main-latest", "latest commit sha should match");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .reply(200, {
        full_name: "octocat/hello-world",
        default_branch: "main",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
      })
      .get("/repos/octocat/hello-world/commits/main")
      .reply(200, {
        sha: "sha-main-latest",
        html_url: "https://github.com/octocat/hello-world/commit/sha-main-latest",
        commit: {
          message: "latest commit",
          author: { name: "The Octocat", date: "2026-03-08T00:00:00Z" },
        },
      })
      .get("/repos/octocat/hello-world/contents/src")
      .query({ ref: "main" })
      .reply(200, { sha: "tree-sha-src" })
      .get("/repos/octocat/hello-world/git/trees/tree-sha-src")
      .reply(200, {
        tree: [
          { path: "index.js", type: "blob", sha: "sha-file-1", size: 120 },
          { path: "lib", type: "tree", sha: "sha-tree-2" },
        ],
      });
    const readTree = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id, tree_path: "src" }),
    });
    assert(readTree.statusCode === 200, "github read tree should return 200");
    const readTreeBody = JSON.parse(readTree.body.toString("utf8"));
    assert(readTreeBody.tree && Array.isArray(readTreeBody.tree.entries), "tree entries should be present");
    assert(readTreeBody.tree.entries.length === 2, "tree entries length should match");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .reply(200, {
        full_name: "octocat/hello-world",
        default_branch: "main",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
      })
      .get("/repos/octocat/hello-world/commits/main")
      .reply(200, {
        sha: "sha-main-latest",
        html_url: "https://github.com/octocat/hello-world/commit/sha-main-latest",
        commit: {
          message: "latest commit",
          author: { name: "The Octocat", date: "2026-03-08T00:00:00Z" },
        },
      })
      .get("/repos/octocat/hello-world/contents/README.md")
      .query({ ref: "main" })
      .reply(200, {
        sha: "sha-readme",
        size: 12,
        encoding: "base64",
        content: Buffer.from("hello world\n", "utf8").toString("base64"),
      });
    const readFile = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id, file_path: "README.md" }),
    });
    assert(readFile.statusCode === 200, "github read file should return 200");
    const readFileBody = JSON.parse(readFile.body.toString("utf8"));
    assert(readFileBody.file.path === "README.md", "file path should match");
    assert(readFileBody.file.content === "hello world\n", "file content should decode base64");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .reply(403, { message: "Resource not accessible by integration" });
    const readForbidden = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(readForbidden.statusCode === 403, "github forbidden should return 403");
    const forbiddenBody = JSON.parse(readForbidden.body.toString("utf8"));
    assert(forbiddenBody.details.code === "INTEGRATION_ERROR", "forbidden should map to INTEGRATION_ERROR");
    assert(forbiddenBody.details.reason === "permission_denied", "forbidden reason should be permission_denied");

    nock("https://api.github.com")
      .get("/repos/octocat/hello-world")
      .reply(404, { message: "Not Found" });
    const readNotFound = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert(readNotFound.statusCode === 404, "github not found should return 404");
    const notFoundBody = JSON.parse(readNotFound.body.toString("utf8"));
    assert(notFoundBody.details.code === "INTEGRATION_ERROR", "not found should map to INTEGRATION_ERROR");
    assert(notFoundBody.details.reason === "not_found", "not found reason should be not_found");

    const ambiguousTarget = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id, file_path: "README.md", tree_path: "src" }),
    });
    assert(ambiguousTarget.statusCode === 400, "ambiguous target should return 400");
    const ambiguousBody = JSON.parse(ambiguousTarget.body.toString("utf8"));
    assert(ambiguousBody.details.code === "VALIDATION_ERROR", "ambiguous target should be validation error");

    const invalidRef = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/read",
      headers: authz,
      body: JSON.stringify({ project_id: project.id, ref: "bad ref name" }),
    });
    assert(invalidRef.statusCode === 400, "invalid ref should return 400");

    nock.cleanAll();
  } finally {
    nock.enableNetConnect();
    nock.cleanAll();
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevReadToken === undefined) delete process.env.GH_READ_TOKEN;
    else process.env.GH_READ_TOKEN = prevReadToken;
  }
}

module.exports = { run };
