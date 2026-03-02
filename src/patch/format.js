const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

function escapePatchLine(line) {
  return String(line || "").replace(/\r?\n/g, " ");
}

function buildAddFilePatch(relativePath, contents) {
  const safePath = String(relativePath || "").replace(/\\/g, "/");
  const lines = String(contents || "").split(/\r?\n/);
  const body = lines.map((line) => `+${escapePatchLine(line)}`).join("\n");
  return [
    `diff --git a/${safePath} b/${safePath}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${safePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
    "",
  ].join("\n");
}

function writePatchArtifact(runId, patchText) {
  const dir = path.join(ROOT_DIR, ".ai-runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = `.ai-runs/${runId}/generated.patch`;
  const absolutePath = path.join(ROOT_DIR, relativePath);
  fs.writeFileSync(absolutePath, patchText, "utf8");
  return {
    relative_path: relativePath,
    absolute_path: absolutePath,
  };
}

module.exports = {
  buildAddFilePatch,
  writePatchArtifact,
};
