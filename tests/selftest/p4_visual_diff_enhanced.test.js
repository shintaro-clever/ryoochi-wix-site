const { assert } = require("./_helpers");
const { compareVisualDiff } = require("../../src/fidelity/visualDiff");

function buildBaseline() {
  return {
    nodes: [
      {
        id: "n1",
        color: { text: "#0f172a", background: "#ffffff", fill: "#ffffff" },
        spacing: { padding_top: 16, padding_right: 16, padding_bottom: 16, padding_left: 16, item_spacing: 8 },
        sizing: { width: 320, height: 48 },
        radius: { top_left: 10, top_right: 10, bottom_right: 10, bottom_left: 10 },
        border: { width: 1, style: "solid", color: "#d1d5db" },
        typography: { font_family: "Inter", font_size: 16, font_weight: 600, line_height: 24, letter_spacing: 0 },
      },
      {
        id: "n2",
        color: { text: "#475569", background: "#f8fafc", fill: "#f8fafc" },
        spacing: { padding_top: 12, padding_right: 12, padding_bottom: 12, padding_left: 12, item_spacing: 4 },
        sizing: { width: 480, height: 220 },
        radius: { top_left: 16, top_right: 16, bottom_right: 16, bottom_left: 16 },
        border: { width: 1, style: "solid", color: "#e2e8f0" },
        typography: { font_family: "Inter", font_size: 14, font_weight: 400, line_height: 20, letter_spacing: 0 },
      },
    ],
  };
}

function buildCandidateGood() {
  return {
    nodes: [
      {
        id: "n1",
        color: { text: "#0f172a", background: "#ffffff", fill: "#ffffff" },
        spacing: { padding_top: 16, padding_right: 16, padding_bottom: 16, padding_left: 16, item_spacing: 8 },
        sizing: { width: 321, height: 48 },
        radius: { top_left: 10, top_right: 10, bottom_right: 10, bottom_left: 10 },
        border: { width: 1, style: "solid", color: "#d1d5db" },
        typography: { font_family: "Inter", font_size: 16, font_weight: 600, line_height: 24, letter_spacing: 0 },
      },
      {
        id: "n2",
        color: { text: "#475569", background: "#f8fafc", fill: "#f8fafc" },
        spacing: { padding_top: 12, padding_right: 12, padding_bottom: 12, padding_left: 12, item_spacing: 4 },
        sizing: { width: 480, height: 220 },
        radius: { top_left: 16, top_right: 16, bottom_right: 16, bottom_left: 16 },
        border: { width: 1, style: "solid", color: "#e2e8f0" },
        typography: { font_family: "Inter", font_size: 14, font_weight: 400, line_height: 20, letter_spacing: 0 },
      },
    ],
  };
}

function buildCandidateBad() {
  return {
    nodes: [
      {
        id: "n1",
        color: { text: "#ff0000", background: "#000000", fill: "#000000" },
        spacing: { padding_top: 30, padding_right: 2, padding_bottom: 30, padding_left: 2, item_spacing: 20 },
        sizing: { width: 410, height: 80 },
        radius: { top_left: 2, top_right: 2, bottom_right: 2, bottom_left: 2 },
        border: { width: 4, style: "dashed", color: "#00ff00" },
        typography: { font_family: "Serif", font_size: 22, font_weight: 300, line_height: 30, letter_spacing: 1.2 },
      },
      {
        id: "n2",
        color: { text: "#111111", background: "#eeeeee", fill: "#eeeeee" },
        spacing: { padding_top: 20, padding_right: 20, padding_bottom: 20, padding_left: 20, item_spacing: 0 },
        sizing: { width: 320, height: 160 },
        radius: { top_left: 0, top_right: 0, bottom_right: 0, bottom_left: 0 },
        border: { width: 0, style: "none", color: "#000000" },
        typography: { font_family: "Mono", font_size: 18, font_weight: 700, line_height: 26, letter_spacing: 0.6 },
      },
    ],
  };
}

async function run() {
  const baseline = buildBaseline();
  const good = buildCandidateGood();
  const bad = buildCandidateBad();

  const goodResult = compareVisualDiff(baseline, good, { threshold: 95 });
  assert(goodResult.pass === true, "good visual candidate should pass threshold");
  assert(goodResult.score >= 95, "good visual score should be >= threshold");

  const badResult = compareVisualDiff(baseline, bad, { threshold: 95 });
  assert(badResult.pass === false, "bad visual candidate should fail threshold");
  assert(badResult.score < 95, "bad visual score should be < threshold");

  assert(typeof badResult.categories.color.score === "number", "color score should be numeric");
  assert(typeof badResult.categories.spacing.score === "number", "spacing score should be numeric");
  assert(typeof badResult.categories.sizing.score === "number", "sizing score should be numeric");
  assert(typeof badResult.categories.radius.score === "number", "radius score should be numeric");
  assert(typeof badResult.categories.border.score === "number", "border score should be numeric");
  assert(typeof badResult.categories.typography.score === "number", "typography score should be numeric");

  assert(badResult.categories.color.mismatch_count >= 1, "color mismatches should be counted");
  assert(badResult.categories.spacing.mismatch_count >= 1, "spacing mismatches should be counted");
  assert(badResult.categories.sizing.mismatch_count >= 1, "sizing mismatches should be counted");
  assert(badResult.categories.radius.mismatch_count >= 1, "radius mismatches should be counted");
  assert(badResult.categories.border.mismatch_count >= 1, "border mismatches should be counted");
  assert(badResult.categories.typography.mismatch_count >= 1, "typography mismatches should be counted");

  const reasons = Array.isArray(badResult.reasons) ? badResult.reasons : [];
  assert(reasons.some((item) => item.category === "color"), "reason should include color");
  assert(reasons.some((item) => item.category === "spacing"), "reason should include spacing");
  assert(reasons.some((item) => item.category === "sizing"), "reason should include sizing");
  assert(reasons.some((item) => item.category === "radius"), "reason should include radius");
  assert(reasons.some((item) => item.category === "border"), "reason should include border");
  assert(reasons.some((item) => item.category === "typography"), "reason should include typography");
}

module.exports = { run };
