const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { writeIngestFile, DEFAULT_ALLOWED_PATHS } = require("../../ingest/figma/store");

function parseUploadBody(body = {}) {
  const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
  const allowedPaths =
    Array.isArray(body.allowed_paths) && body.allowed_paths.length > 0
      ? body.allowed_paths.filter((entry) => typeof entry === "string")
      : DEFAULT_ALLOWED_PATHS;

  if (body.json && typeof body.json === "object") {
    const text = JSON.stringify(body.json, null, 2);
    return { fileName: fileName || `figma_ingest_${Date.now()}.json`, buffer: Buffer.from(text, "utf8"), allowedPaths };
  }

  if (typeof body.content_base64 === "string" && body.content_base64.trim()) {
    return {
      fileName: fileName || `figma_ingest_${Date.now()}.zip`,
      buffer: Buffer.from(body.content_base64, "base64"),
      allowedPaths,
    };
  }

  throw new Error("json or content_base64 is required");
}

async function handleFigmaIngest(req, res) {
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

  try {
    const parsed = parseUploadBody(body);
    const stored = writeIngestFile(parsed);
    return sendJson(res, 201, {
      source: "figma",
      artifact_type: parsed.fileName.endsWith(".zip") ? "zip" : "json",
      artifact_path: stored.relative_path,
      size: stored.size,
      allowed_paths: parsed.allowedPaths,
    });
  } catch (error) {
    return jsonError(res, 400, "VALIDATION_ERROR", error.message || "ingest failed", {
      failure_code: "validation_error",
    });
  }
}

module.exports = {
  handleFigmaIngest,
};
