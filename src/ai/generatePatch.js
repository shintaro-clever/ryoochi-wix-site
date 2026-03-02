const { buildAddFilePatch } = require("../patch/format");

function generatePatchFromJob({ runId, job, plan }) {
  const target = `vault/tmp/figma_patch_${runId}.txt`;
  const content = [
    `run_id=${runId}`,
    `job_type=${job.job_type}`,
    `summary=${plan.summary}`,
    "generated_by=minimal-ai-skeleton",
  ].join("\n");
  const patch = buildAddFilePatch(target, content);
  return {
    target_path: target,
    patch,
  };
}

module.exports = {
  generatePatchFromJob,
};
