const { assert } = require("./_helpers");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun, getRun, appendRunExternalOperation, patchRunInputs } = require("../../src/api/runs");

async function run() {
  const runId = createRun(db, {
    job_type: "integration_hub.phase1.code_to_figma_from_url",
    run_mode: "mcp",
    target_path: ".ai-runs/{{run_id}}/p4_run_fidelity_evidence.json",
    inputs: {
      connection_context: {
        figma: {
          provider: "figma",
          status: "ok",
          file_key: "figma-file-key",
          target: {
            page_id: "1:1",
            page_name: "Landing",
            frame_id: "10:1",
            frame_name: "Hero",
            node_ids: ["10:2", "10:3"],
          },
          comparison_target: {
            id: "frame:10:1",
            mode: "frame",
          },
        },
      },
      fidelity_environment: {
        version: "phase4-env-v1",
        target_environment: "staging",
        compare_environments: ["staging", "production"],
        environments: {
          staging: { url: "https://staging.example.com" },
          production: { url: "https://example.com" },
        },
        conditions: {
          viewport: { preset: "desktop", width: 1280, height: 720 },
          theme: "light",
          auth_state: { staging: "signed_in", production: "signed_in" },
          fixture_data: { mode: "seeded", dataset_id: "baseline", snapshot_id: "latest", seed: "42" },
        },
      },
      capture_request: {
        target_url: "https://staging.example.com/landing",
        viewport: { width: 1280, height: 720 },
        theme: "light",
      },
      capture_result: {
        status: "ok",
        output_path: ".ai-runs/mock/capture.png",
        state_results: [
          { state: "hover", status: "ok", artifact_path: ".ai-runs/mock/capture-hover.png" },
        ],
      },
      structure_diff: {
        threshold: 0.95,
        structural_reproduction: { rate: 0.98, status: "good" },
        diffs: {
          reasons: [
            { axis: "structure", reason_code: "slot_changed" },
          ],
        },
        counts: {
          baseline_nodes: 2,
          missing_in_candidate: 0,
          extra_in_candidate: 0,
          target_mismatches: 0,
        },
      },
      visual_diff: {
        threshold: 95,
        score: 96.2,
        status: "good",
        reasons: [
          { axis: "visual", reason_code: "color_changed" },
        ],
      },
      behavior_diff: {
        threshold: 95,
        score: 95,
        status: "good",
        reasons: [
          { axis: "behavior", reason_code: "state_signature_changed" },
        ],
      },
      execution_diff: {
        threshold: 95,
        score: 94,
        status: "bad",
        environment_only_mismatch: true,
        reasons: [
          { axis: "execution", reason_code: "environment_only_mismatch" },
        ],
      },
      phase4_score: {
        final_score: 95.3,
        threshold: 95,
        status: "passed_with_environment_mismatch",
      },
    },
  });

  const patched = patchRunInputs(db, runId, {
    capture_result: {
      status: "ok",
      output_path: ".ai-runs/mock/capture-v2.png",
      state_results: [
        { state: "hover", status: "ok", artifact_path: ".ai-runs/mock/capture-v2-hover.png" },
      ],
    },
  });
  assert(patched === true, "patchRunInputs should succeed");

  const opOk = appendRunExternalOperation(db, runId, {
    provider: "fidelity",
    operation_type: "fidelity.execution_diff",
    target: { path: ".ai-runs/mock" },
    result: { status: "ok", failure_code: null, reason: null },
    artifacts: { paths: [".ai-runs/mock/execution-diff.json"] },
  });
  assert(opOk === true, "appendRunExternalOperation should succeed");

  const detail = getRun(db, runId);
  assert(detail, "run should exist");
  assert(detail.inputs && detail.inputs.fidelity_evidence, "inputs should include fidelity_evidence");
  assert(detail.context_used && detail.context_used.fidelity_evidence, "context_used should include fidelity_evidence");

  const evidence = detail.inputs.fidelity_evidence;
  assert(evidence.figma_target && evidence.figma_target.frame_id === "10:1", "figma target should be stored");
  assert(evidence.environment && evidence.environment.target_environment === "staging", "environment should be stored");
  assert(
    evidence.capture && evidence.capture.request && evidence.capture.request.viewport.width === 1280,
    "capture conditions should be stored"
  );
  assert(
    evidence.diff_scores &&
      evidence.diff_scores.structure && typeof evidence.diff_scores.structure.score === "number" &&
      evidence.diff_scores.behavior && typeof evidence.diff_scores.behavior.score === "number",
    "diff scores should be stored"
  );
  assert(
    evidence.diff_reasons && evidence.diff_reasons.counts && evidence.diff_reasons.counts.total >= 1,
    "diff reasons should be stored"
  );
  assert(
    evidence.artifacts &&
      Array.isArray(evidence.artifacts.paths) &&
      evidence.artifacts.paths.includes(".ai-runs/mock/execution-diff.json") &&
      evidence.artifacts.paths.includes(".ai-runs/mock/capture-v2.png"),
    "comparison artifacts should be stored"
  );

  db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);
}

module.exports = { run };
