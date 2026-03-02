const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { listRuns, createRun } = require("../../api/runs");

async function handleRunsCollection(req, res, db, { onRunQueued } = {}) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET") {
    return sendJson(res, 200, listRuns(db));
  }
  if (method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
  }
  const jobType = typeof body.job_type === "string" ? body.job_type.trim() : "";
  const targetPath = typeof body.target_path === "string" ? body.target_path.trim() : "";
  if (!jobType || !targetPath) {
    return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です");
  }
  const inputs = body && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {};
  const runMode = typeof body.run_mode === "string" && body.run_mode.trim() ? body.run_mode.trim() : "mcp";
  const figmaFileKey =
    typeof body.figma_file_key === "string" && body.figma_file_key.trim()
      ? body.figma_file_key.trim()
      : typeof inputs.figma_file_key === "string" && inputs.figma_file_key.trim()
        ? inputs.figma_file_key.trim()
        : null;
  const ingestArtifactPath =
    typeof body.ingest_artifact_path === "string" && body.ingest_artifact_path.trim()
      ? body.ingest_artifact_path.trim()
      : typeof inputs.ingest_artifact_path === "string" && inputs.ingest_artifact_path.trim()
        ? inputs.ingest_artifact_path.trim()
        : null;
  const runId = createRun(db, {
    job_type: jobType,
    run_mode: runMode,
    inputs,
    target_path: targetPath,
    figma_file_key: figmaFileKey,
    ingest_artifact_path: ingestArtifactPath,
  });
  if (typeof onRunQueued === "function") {
    onRunQueued(runId);
  }
  return sendJson(res, 201, { run_id: runId, status: "queued" });
}

module.exports = {
  handleRunsCollection,
};
