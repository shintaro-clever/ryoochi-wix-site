const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];

  try {
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
      body: JSON.stringify({ name: "pset-settings-test", staging_url: "https://example.com" }),
    });
    assert(createRes.statusCode === 201, `project create should return 201, got ${createRes.statusCode}`);
    const project = JSON.parse(createRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project.id should be public project ID");
    createdProjectIds.push(parsedProject.internalId);
    const pid = project.id;

    const getDefault = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/settings`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getDefault.statusCode === 200, `settings GET should return 200, got ${getDefault.statusCode}`);
    const defaultBody = JSON.parse(getDefault.body.toString("utf8"));
    assert(defaultBody.project_id === pid, "settings project_id should match");
    assert(defaultBody.github_repository === "", "default github_repository should be empty");
    assert(defaultBody.github_default_branch === "", "default github_default_branch should be empty");
    assert(defaultBody.github_installation_ref === "", "default github_installation_ref should be empty");
    assert(defaultBody.github_secret_id === "", "default github_secret_id should be empty");
    assert(defaultBody.figma_file === "", "default figma_file should be empty");
    assert(defaultBody.figma_file_key === "", "default figma_file_key should be empty");
    assert(defaultBody.figma_secret_id === "", "default figma_secret_id should be empty");
    assert(defaultBody.figma_page_scope === "", "default figma_page_scope should be empty");
    assert(defaultBody.figma_frame_scope === "", "default figma_frame_scope should be empty");
    assert(defaultBody.figma_writable_scope === "", "default figma_writable_scope should be empty");
    assert(defaultBody.github_operation_mode === "", "default github_operation_mode should be empty");
    assert(defaultBody.github_allowed_branches === "", "default github_allowed_branches should be empty");
    assert(defaultBody.figma_operation_mode === "", "default figma_operation_mode should be empty");
    assert(defaultBody.figma_allowed_frame_scope === "", "default figma_allowed_frame_scope should be empty");
    assert(defaultBody.drive_url === "", "default drive_url should be empty");

    const putRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        github_default_branch: "main",
        github_installation_ref: "vault://github/installations/proj-1",
        github_secret_id: "vault://github/tokens/proj-1",
        github_writable_scope: "pull_request",
        github_operation_mode: "controlled_write",
        github_allowed_branches: "main,release/*",
        figma_file: "https://www.figma.com/file/abc123/Design",
        figma_file_key: "abc123",
        figma_secret_id: "vault://figma/tokens/proj-1",
        figma_page_scope: "page:Landing",
        figma_frame_scope: "frame:Hero",
        figma_writable_scope: "frame",
        figma_operation_mode: "read_only",
        figma_allowed_frame_scope: "frame:Hero",
        drive_url: "https://drive.google.com/drive/folders/folder123",
      }),
    });
    assert(putRes.statusCode === 200, `settings PUT should return 200, got ${putRes.statusCode}`);
    const putBody = JSON.parse(putRes.body.toString("utf8"));
    assert(putBody.project_id === pid, "PUT response project_id should match");
    assert(putBody.github_repository === "octocat/hello-world", "github_repository should be saved");
    assert(putBody.github_default_branch === "main", "github_default_branch should be saved");
    assert(
      putBody.github_installation_ref === "vault://github/installations/proj-1",
      "github_installation_ref should be saved"
    );
    assert(putBody.github_secret_id === "vault://github/tokens/proj-1", "github_secret_id should be saved");
    assert(putBody.github_writable_scope === "pull_request", "github_writable_scope should be saved");
    assert(putBody.github_operation_mode === "controlled_write", "github_operation_mode should be saved");
    assert(putBody.github_allowed_branches === "main,release/*", "github_allowed_branches should be saved");
    assert(putBody.figma_file.includes("figma.com"), "figma_file should be saved");
    assert(putBody.figma_file_key === "abc123", "figma_file_key should be saved");
    assert(putBody.figma_secret_id === "vault://figma/tokens/proj-1", "figma_secret_id should be saved");
    assert(putBody.figma_page_scope === "page:Landing", "figma_page_scope should be saved");
    assert(putBody.figma_frame_scope === "frame:Hero", "figma_frame_scope should be saved");
    assert(putBody.figma_writable_scope === "frame", "figma_writable_scope should be saved");
    assert(putBody.figma_operation_mode === "read_only", "figma_operation_mode should be saved");
    assert(putBody.figma_allowed_frame_scope === "frame:Hero", "figma_allowed_frame_scope should be saved");
    assert(putBody.drive_url.includes("drive.google.com"), "drive_url should be saved");

    const getAfterPut = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/settings`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getAfterPut.statusCode === 200, `settings GET after PUT should return 200`);
    const getAfterPutBody = JSON.parse(getAfterPut.body.toString("utf8"));
    assert(getAfterPutBody.github_repository === "octocat/hello-world", "round-trip github_repository should match");
    assert(getAfterPutBody.github_default_branch === "main", "round-trip github_default_branch should match");
    assert(
      getAfterPutBody.github_installation_ref === "vault://github/installations/proj-1",
      "round-trip github_installation_ref should match"
    );
    assert(
      getAfterPutBody.github_secret_id === "vault://github/tokens/proj-1",
      "round-trip github_secret_id should match"
    );
    assert(getAfterPutBody.figma_file.includes("figma.com"), "round-trip figma_file should match");
    assert(getAfterPutBody.figma_file_key === "abc123", "round-trip figma_file_key should match");
    assert(
      getAfterPutBody.figma_secret_id === "vault://figma/tokens/proj-1",
      "round-trip figma_secret_id should match"
    );
    assert(getAfterPutBody.figma_page_scope === "page:Landing", "round-trip figma_page_scope should match");
    assert(getAfterPutBody.figma_frame_scope === "frame:Hero", "round-trip figma_frame_scope should match");
    assert(getAfterPutBody.figma_writable_scope === "frame", "round-trip figma_writable_scope should match");
    assert(getAfterPutBody.github_operation_mode === "controlled_write", "round-trip github_operation_mode should match");
    assert(getAfterPutBody.github_allowed_branches === "main,release/*", "round-trip github_allowed_branches should match");
    assert(getAfterPutBody.figma_operation_mode === "read_only", "round-trip figma_operation_mode should match");
    assert(getAfterPutBody.figma_allowed_frame_scope === "frame:Hero", "round-trip figma_allowed_frame_scope should match");
    assert(getAfterPutBody.drive_url.includes("drive.google.com"), "round-trip drive_url should match");

    const putInvalidRepo = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/settings`,
      headers: authz,
      body: JSON.stringify({ github_repository: "invalid repo" }),
    });
    assert(putInvalidRepo.statusCode === 400, `invalid github repository should return 400, got ${putInvalidRepo.statusCode}`);

    const putInvalidDrive = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/settings`,
      headers: authz,
      body: JSON.stringify({ drive_url: "http://drive.google.com/folders/abc" }),
    });
    assert(putInvalidDrive.statusCode === 400, `non-https drive url should return 400, got ${putInvalidDrive.statusCode}`);

    const putRawSecret = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/settings`,
      headers: authz,
      body: JSON.stringify({ github_secret_id: "ghp_plainSecretShouldNotBeStored" }),
    });
    assert(putRawSecret.statusCode === 400, `raw github secret must be rejected, got ${putRawSecret.statusCode}`);

    const prevGithubToken = process.env.GITHUB_TOKEN;
    try {
      delete process.env.GITHUB_TOKEN;
      const putMissingSecret = await requestLocal(handler, {
        method: "PUT",
        url: `/api/projects/${pid}/settings`,
        headers: authz,
        body: JSON.stringify({
          github_repository: "octocat/no-secret",
          github_secret_id: "",
        }),
      });
      assert(
        putMissingSecret.statusCode === 400,
        `missing github_secret_id should return 400, got ${putMissingSecret.statusCode}`
      );
    } finally {
      if (prevGithubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevGithubToken;
    }

    const notFound = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/project_${crypto.randomUUID()}/settings`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(notFound.statusCode === 404, `missing project should return 404, got ${notFound.statusCode}`);
  } finally {
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
