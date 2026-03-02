const { db, DEFAULT_TENANT } = require("./index");
const { withRetry } = require("./retry");

function updateRunTrace({
  tenantId = DEFAULT_TENANT,
  runId,
  figmaFileKey,
  ingestArtifactPath,
  githubPrUrl,
  githubPrNumber,
  dbConn = db,
} = {}) {
  if (!runId) {
    throw new Error("runId is required");
  }
  const updates = [];
  const values = [];
  if (figmaFileKey !== undefined) {
    updates.push("figma_file_key=?");
    values.push(figmaFileKey || null);
  }
  if (ingestArtifactPath !== undefined) {
    updates.push("ingest_artifact_path=?");
    values.push(ingestArtifactPath || null);
  }
  if (githubPrUrl !== undefined) {
    updates.push("github_pr_url=?");
    values.push(githubPrUrl || null);
  }
  if (githubPrNumber !== undefined) {
    updates.push("github_pr_number=?");
    values.push(githubPrNumber || null);
  }
  if (updates.length === 0) {
    return false;
  }
  updates.push("updated_at=?");
  values.push(new Date().toISOString());
  values.push(tenantId, runId);
  const info = withRetry(() =>
    dbConn
      .prepare(`UPDATE runs SET ${updates.join(",")} WHERE tenant_id=? AND id=?`)
      .run(...values)
  );
  return info.changes > 0;
}

module.exports = {
  updateRunTrace,
};
