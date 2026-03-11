const { sendJson, jsonError } = require("../../api/projects");
const { DEFAULT_TENANT } = require("../../db");
const { listExecutionPlans } = require("../../db/executionPlans");
const { listExecutionJobs } = require("../../db/executionJobs");
const { toExecutionPlanApi } = require("../executionPlans");
const { toExecutionJobApi } = require("../executionJobs");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function countBy(items, mapper) {
  const counts = new Map();
  items.forEach((item) => {
    const key = normalizeText(mapper(item)) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function summarizeFailure(job) {
  const details = [];
  if (normalizeText(job.status)) details.push(job.status);
  if (normalizeText(job.safety_level)) details.push(job.safety_level);
  return details.join(" / ");
}

async function handleAdminExecutionOverview(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  if (parsedUrl.pathname !== "/api/admin/execution-overview") return false;
  if (method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return true;
  }

  try {
    const filters = {
      projectId: normalizeText(parsedUrl.searchParams.get("project_id")),
      limit: Math.max(5, Math.min(100, Number(parsedUrl.searchParams.get("limit")) || 20)),
    };
    const plans = listExecutionPlans({
      tenantId: DEFAULT_TENANT,
      projectId: filters.projectId,
      dbConn: db,
      limit: Math.max(filters.limit * 4, 40),
    });
    const jobs = listExecutionJobs({
      tenantId: DEFAULT_TENANT,
      projectId: filters.projectId,
      dbConn: db,
    });

    const confirmWaitingPlans = plans.filter((plan) => plan.confirm_required && ["pending", "expired", "revoked"].includes(plan.confirm_state));
    const rejectedPlans = plans.filter((plan) => plan.confirm_state === "rejected");
    const failedJobs = jobs.filter((job) => job.status === "failed" || job.status === "cancelled");
    const runningJobs = jobs.filter((job) => job.status === "running");

    return sendJson(res, 200, {
      generated_at: new Date().toISOString(),
      filters,
      summary: {
        total_plans: plans.length,
        confirm_waiting_plans: confirmWaitingPlans.length,
        rejected_plans: rejectedPlans.length,
        total_jobs: jobs.length,
        running_jobs: runningJobs.length,
        failed_jobs: failedJobs.length,
      },
      breakdowns: {
        plan_status: countBy(plans, (plan) => plan.status).map((row) => ({ status: row.key, count: row.count })),
        plan_confirm_state: countBy(plans, (plan) => plan.confirm_state).map((row) => ({ confirm_state: row.key, count: row.count })),
        job_status: countBy(jobs, (job) => job.status).map((row) => ({ status: row.key, count: row.count })),
      },
      plans: {
        confirm_waiting: confirmWaitingPlans.slice(0, filters.limit).map(toExecutionPlanApi),
        rejected: rejectedPlans.slice(0, filters.limit).map(toExecutionPlanApi),
        recent: plans.slice(0, filters.limit).map(toExecutionPlanApi),
      },
      jobs: {
        failed: failedJobs.slice(0, filters.limit).map((job) => ({
          ...toExecutionJobApi(job),
          failure_summary: summarizeFailure(job),
        })),
        running: runningJobs.slice(0, filters.limit).map(toExecutionJobApi),
        recent: jobs.slice(0, filters.limit).map(toExecutionJobApi),
      },
    });
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      error.code || "SERVICE_UNAVAILABLE",
      error.message || "admin execution overview failed",
      error.details || { failure_code: error.failure_code || "service_unavailable" }
    );
  }
}

module.exports = {
  handleAdminExecutionOverview,
};
