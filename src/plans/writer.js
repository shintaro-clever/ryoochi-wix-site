const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

function ensureRunDir(runId) {
  const dir = path.join(ROOT_DIR, ".ai-runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function createPlanWriter(runId) {
  const dir = ensureRunDir(runId);
  const planPath = path.join(dir, "plan.json");
  const logPath = path.join(dir, "plan.log");

  function appendLog(line) {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
  }

  function writePlan(plan) {
    writeJson(planPath, plan);
  }

  return {
    planPath,
    logPath,
    appendLog,
    writePlan,
  };
}

module.exports = {
  createPlanWriter,
};
