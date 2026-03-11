"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assert } = require("./_helpers");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createExecutionPlan, getExecutionPlan } = require("../../src/db/executionPlans");
const { toExecutionPlanApi } = require("../../src/server/executionPlans");
const {
  SOURCE_TYPES,
  TARGET_KINDS,
  RISK_LEVELS,
  normalizeTargetRefs,
  normalizeImpactScope,
  normalizeEvidenceRefs,
  normalizeConfirmPolicy,
  normalizeRollbackPlan,
} = require("../../src/types/changePlan");

async function run() {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs/ai/core/execution-plan-model.md"), "utf8");
  assert(doc.includes("確認可能で監査可能な変更計画"), "doc should define execution plan as confirmable and auditable");
  assert(doc.includes("Proposal vs Write-Plan vs Execution Plan"), "doc should distinguish proposal, write-plan and execution plan");
  assert(doc.includes("Common Change Model"), "doc should define common model primitives");
  assert(doc.includes("write-plan は proposal を実行可能形へ寄せる準備層"), "doc should define write-plan positioning");
  assert(doc.includes("plan_id"), "doc should include plan_id");
  assert(doc.includes("tenant_id"), "doc should include tenant_id");
  assert(doc.includes("project_id"), "doc should include project_id");
  assert(doc.includes("thread_id"), "doc should include thread_id");
  assert(doc.includes("run_id"), "doc should include run_id");
  assert(doc.includes("confirm_policy"), "doc should include confirm_policy");
  assert(doc.includes("confirm_state"), "doc should include confirm_state");
  assert(doc.includes("confirm_session"), "doc should include confirm_session");
  assert(doc.includes("impact_scope"), "doc should include impact_scope");
  assert(doc.includes("rollback_plan"), "doc should include rollback_plan");
  assert(doc.includes("Status Transition"), "doc should include status transitions");
  assert(doc.includes("server 保存前提"), "doc should require server persistence");
  assert(SOURCE_TYPES.includes("phase5_ai_proposal"), "shared model should include proposal source type");
  assert(TARGET_KINDS.includes("mixed"), "shared model should include mixed target kind");
  assert(RISK_LEVELS.includes("critical"), "shared model should include risk levels");

  const sharedTargets = normalizeTargetRefs([
    { system: "github", target_type: "file", path: "README.md", writable: true },
    { system: "figma", target_type: "frame", id: "1:2", name: "Hero" },
  ]);
  assert(sharedTargets.length === 2, "shared target_refs should support multiple targets");

  const sharedScope = normalizeImpactScope({
    scope: "project",
    details: [{ kind: "repo", ref: "owner/repo", summary: "repo change" }],
  });
  assert(sharedScope.scope === "project", "shared impact_scope should normalize scope");
  assert(sharedScope.details.length === 1, "shared impact_scope should normalize details");

  const sharedEvidence = normalizeEvidenceRefs({
    ai_summaries: [{ system: "openai", ref_kind: "summary", ref_id: "sum-001" }],
    other_refs: [{ system: "github", ref_kind: "doc", path: "README.md" }],
  });
  assert(sharedEvidence.ai_summaries.length === 1, "shared evidence refs should normalize ai summaries");
  assert(sharedEvidence.other_refs.length === 1, "shared evidence refs should normalize other refs");

  const sharedConfirm = normalizeConfirmPolicy({
    required_approvers: [{ actor_id: "user-001", role: "project_operator" }],
    required_views: [{ view_id: "diff-preview" }],
  });
  assert(sharedConfirm.required_approvers.length === 1, "shared confirm policy should keep approvers");
  assert(sharedConfirm.required_views.length === 1, "shared confirm policy should keep required views");

  const sharedRollback = normalizeRollbackPlan({
    rollback_type: "git_revert",
    rollback_steps: [{ step: "Revert README change" }],
  });
  assert(sharedRollback.rollback_steps.length === 1, "shared rollback plan should keep steps");

  const projectId = `project-${crypto.randomUUID()}`;
  let createdPlanId = null;
  try {
    const plan = createExecutionPlan({
      tenantId: DEFAULT_TENANT,
      payload: {
        project_id: projectId,
        thread_id: "thread-public-001",
        run_id: "run-public-001",
        source_type: "phase5_ai_proposal",
        source_ref: {
          system: "openai",
          ref_kind: "ai_summary",
          ref_id: "sum-001",
          path: "docs/ai/core/workflow.md",
          label: "phase5-summary",
        },
        plan_type: "docs_update",
        target_kind: "mixed",
        target_refs: [
          {
            system: "github",
            target_type: "file",
            path: "README.md",
            name: "README",
            scope: "repo",
            writable: true,
          },
          {
            system: "figma",
            target_type: "frame",
            id: "12:34",
            name: "Hero frame",
            scope: "frame",
            writable: false,
          },
        ],
        requested_by: "user-001",
        proposed_by_ai: true,
        summary: "Update docs and linked frame guidance",
        expected_changes: [
          {
            change_type: "update",
            summary: "Adjust README phase wording",
            target_ref: { system: "github", target_type: "file", path: "README.md", writable: true },
            patch_hint: "replace phase section",
          },
        ],
        evidence_refs: {
          run_artifacts: [{ system: "hub", ref_kind: "run_artifact", ref_id: "artifact-001", label: "run artifact" }],
          compare_results: [{ system: "hub", ref_kind: "compare_result", ref_id: "cmp-001", label: "compare result" }],
          ai_summaries: [{ system: "openai", ref_kind: "summary", ref_id: "sum-001", label: "ai summary" }],
          source_documents: [{ system: "github", ref_kind: "doc", path: "README.md", label: "README" }],
        },
        impact_scope: {
          scope: "project",
          details: [
            { kind: "repo", ref: "octocat/hello-world", summary: "repo text update" },
            { kind: "frame", ref: "12:34", summary: "figma review target" },
          ],
        },
        risk_level: "medium",
        confirm_required: true,
        plan_version: 1,
        confirm_state: "pending",
        confirm_policy: {
          mode: "explicit_confirm",
          required_approvers: [{ type: "user", actor_id: "user-001", role: "project_operator", label: "operator" }],
          required_views: [{ view_id: "diff-preview", label: "Diff Preview", required: true }],
          approval_conditions: [{ condition_id: "evidence-reviewed", summary: "evidence reviewed", check_type: "manual_check" }],
        },
        rollback_plan: {
          rollback_type: "git_revert",
          rollback_steps: [{ step: "Revert README change", target_ref: { system: "github", target_type: "file", path: "README.md" } }],
          rollback_preconditions: [{ summary: "Previous README content is still available", required: true }],
        },
        status: "confirm_pending",
        internal_meta: {
          orchestration_hint: {
            candidate_job_kind: "execution_job",
          },
        },
      },
      dbConn: db,
    });
    createdPlanId = plan.plan_id;

    const stored = getExecutionPlan({ tenantId: DEFAULT_TENANT, planId: plan.plan_id, dbConn: db });
    assert(stored && stored.plan_id === plan.plan_id, "stored plan should be retrievable");
    assert(stored.tenant_id === DEFAULT_TENANT, "stored plan should include tenant");
    assert(stored.project_id === projectId, "stored plan should include project");
    assert(stored.thread_id === "thread-public-001", "stored plan should include thread");
    assert(stored.run_id === "run-public-001", "stored plan should include run");
    assert(stored.confirm_required === true, "stored plan should keep confirm_required");
    assert(stored.plan_version === 1, "stored plan should keep plan_version");
    assert(stored.confirm_state === "pending", "stored plan should keep confirm_state");
    assert(stored.confirm_policy.required_approvers.length === 1, "confirm policy should keep approvers");
    assert(stored.impact_scope.scope === "project", "impact scope should keep enum");
    assert(stored.impact_scope.details.length === 2, "impact scope should keep details");
    assert(stored.rollback_plan.rollback_type === "git_revert", "rollback plan should keep rollback_type");
    assert(stored.rollback_plan.rollback_steps.length === 1, "rollback plan should keep steps");
    assert(stored.evidence_refs.compare_results.length === 1, "evidence refs should keep compare results");
    assert(stored.target_refs.length === 2, "target refs should support multiple targets");

    const apiView = toExecutionPlanApi(stored);
    assert(apiView.plan_id === plan.plan_id, "api view should include plan_id");
    assert(apiView.confirm_state === "pending", "api view should include confirm_state");
    assert(apiView.confirm_policy.required_views.length === 1, "api view should include confirm policy");
    assert(apiView.rollback_plan.rollback_preconditions.length === 1, "api view should include rollback preconditions");
    assert(!Object.prototype.hasOwnProperty.call(apiView, "internal_meta"), "api view should not expose internal_meta");
  } finally {
    if (createdPlanId) {
      db.prepare("DELETE FROM execution_plans WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, createdPlanId);
    }
  }
}

module.exports = { run };
