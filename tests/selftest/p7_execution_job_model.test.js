"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeExecutionJob } = require("../../src/types/executionJob");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const doc = fs.readFileSync(path.join(root, "docs/ai/core/execution-job-model.md"), "utf8");
  const schema = fs.readFileSync(path.join(root, "src/db/schema.sql"), "utf8");

  assert(doc.includes("Execution Job Model (Phase7 SoT)"), "doc should define execution job model");
  assert(doc.includes("job_type"), "doc should define job_type");
  assert(doc.includes("target_scope"), "doc should define target_scope");
  assert(doc.includes("inputs"), "doc should define inputs");
  assert(doc.includes("safety_level"), "doc should define safety_level");
  assert(doc.includes("confirm_state"), "doc should define confirm_state");
  assert(doc.includes("plan_ref"), "doc should define plan_ref");
  assert(doc.includes("run_ref"), "doc should define run_ref");

  assert(schema.includes("CREATE TABLE IF NOT EXISTS execution_jobs"), "schema should define execution_jobs");
  assert(schema.includes("job_type"), "schema should include job_type");
  assert(schema.includes("target_scope_json"), "schema should include target_scope_json");
  assert(schema.includes("inputs_json"), "schema should include inputs_json");
  assert(schema.includes("safety_level"), "schema should include safety_level");
  assert(schema.includes("confirm_state"), "schema should include confirm_state");
  assert(schema.includes("plan_ref_json"), "schema should include plan_ref_json");
  assert(schema.includes("run_ref_json"), "schema should include run_ref_json");

  const normalized = normalizeExecutionJob({
    execution_job_id: "job-1",
    tenant_id: "internal",
    project_id: "project_123",
    job_type: "docs_update_job",
    target_scope: {
      target_kind: "github",
      impact_scope: { scope: "project", details: [{ kind: "file", ref: "docs/runbook.md", summary: "runbook" }] },
      target_refs: [{ system: "github", target_type: "file", path: "docs/runbook.md", writable: true }],
    },
    inputs: {
      summary: "Update docs",
      expected_changes: [{ change_type: "update", summary: "refresh docs" }],
      rollback_plan: { rollback_type: "git_revert", rollback_steps: [{ step: "revert commit" }] },
      evidence_refs: { other_refs: [{ system: "repo", ref_kind: "doc", path: "docs/runbook.md" }] },
    },
    safety_level: "elevated",
    confirm_state: "approved",
    plan_ref: {
      plan_id: "plan-1",
      current_plan_version: 2,
      confirm_state: "approved",
      source_type: "phase5_ai_proposal",
      source_ref: { system: "hub", ref_kind: "write_plan", ref_id: "wp-1" },
    },
    run_ref: {
      run_id: "run_123",
      thread_id: "thread_123",
      project_id: "project_123",
    },
  });

  assert(normalized.job_type === "docs_update_job", "job_type should survive normalization");
  assert(normalized.target_scope.target_kind === "github", "target_scope should survive normalization");
  assert(normalized.safety_level === "elevated", "safety_level should survive normalization");
  assert(normalized.confirm_state === "approved", "confirm_state should survive normalization");
  assert(normalized.plan_ref.plan_id === "plan-1", "plan_ref should survive normalization");
  assert(normalized.run_ref.run_id === "run_123", "run_ref should survive normalization");
}

module.exports = { run };
