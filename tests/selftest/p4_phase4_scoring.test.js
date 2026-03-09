const { assert } = require("./_helpers");
const { computePhase4FidelityScore } = require("../../src/fidelity/phase4Scoring");

function buildGoodPayload() {
  return {
    structure_diff: {
      major_diff_detected: false,
      structural_reproduction: { rate: 0.99 },
      counts: {
        baseline_nodes: 10,
        missing_in_candidate: 0,
        extra_in_candidate: 0,
        target_mismatches: 0,
      },
    },
    visual_diff: { score: 97.2 },
    behavior_diff: { score: 96.0 },
    execution_diff: { score: 95.5, environment_only_mismatch: false, mismatch_fields: { environment: [], execution: [] } },
  };
}

async function run() {
  const good = computePhase4FidelityScore(buildGoodPayload());
  assert(good.pass === true, "good payload should pass");
  assert(good.status === "passed", "good payload status should be passed");
  assert(good.final_score >= 95, "good final score should be >= 95");
  assert(good.target_alignment.target_alignment_100 === true, "target alignment should be 100%");

  const gateFailPayload = buildGoodPayload();
  gateFailPayload.structure_diff.counts.target_mismatches = 1;
  const gateFail = computePhase4FidelityScore(gateFailPayload);
  assert(gateFail.pass === false, "target mismatch should hard fail");
  assert(gateFail.failure_code === "target_alignment_not_100", "failure code should classify target alignment");
  assert(
    Array.isArray(gateFail.hard_gates) && gateFail.hard_gates.some((g) => g.id === "target_alignment_100" && g.pass === false),
    "target_alignment_100 gate should fail"
  );

  const envOnlyPayload = buildGoodPayload();
  envOnlyPayload.execution_diff = {
    score: 80,
    environment_only_mismatch: true,
    mismatch_fields: {
      environment: ["font_fallback", "viewport", "theme", "data_state", "browser"],
      execution: [],
    },
  };
  const envOnly = computePhase4FidelityScore(envOnlyPayload);
  assert(envOnly.pass === true, "environment-only mismatch should not hard fail by itself");
  assert(envOnly.status === "passed_with_environment_mismatch", "status should separate environment-only mismatch");
  assert(
    Array.isArray(envOnly.reasons) && envOnly.reasons.some((r) => r.reason_code === "environment_only_mismatch"),
    "environment_only_mismatch reason should exist"
  );

  const incomplete = computePhase4FidelityScore({
    structure_diff: buildGoodPayload().structure_diff,
    visual_diff: { score: 99 },
  });
  assert(incomplete.status === "incomplete", "missing axis should be incomplete");
  assert(incomplete.failure_code === "axis_missing", "missing axis failure code should be fixed");
}

module.exports = { run };
