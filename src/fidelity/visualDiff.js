"use strict";
const { annotateReasons, summarizeByType } = require("./reasonTaxonomy");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function numberDiffRatio(base, cand) {
  const b = asNumber(base);
  const c = asNumber(cand);
  if (b === null && c === null) return 0;
  if (b === null || c === null) return 1;
  const denom = Math.max(Math.abs(b), Math.abs(c), 1);
  return clamp01(Math.abs(b - c) / denom);
}

function textDiffRatio(base, cand) {
  const b = asText(base);
  const c = asText(cand);
  return b === c ? 0 : 1;
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function normalizeNode(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const spacing = source.spacing && typeof source.spacing === "object" ? source.spacing : {};
  const sizing = source.sizing && typeof source.sizing === "object" ? source.sizing : {};
  const radius = source.radius && typeof source.radius === "object" ? source.radius : {};
  const border = source.border && typeof source.border === "object" ? source.border : {};
  const typography = source.typography && typeof source.typography === "object" ? source.typography : {};
  return {
    id: asText(source.id),
    color: {
      text: asText(source.color?.text || source.text_color),
      background: asText(source.color?.background || source.background_color),
      fill: asText(source.color?.fill || source.fill_color),
    },
    spacing: {
      padding_top: asNumber(spacing.padding_top ?? source.padding_top),
      padding_right: asNumber(spacing.padding_right ?? source.padding_right),
      padding_bottom: asNumber(spacing.padding_bottom ?? source.padding_bottom),
      padding_left: asNumber(spacing.padding_left ?? source.padding_left),
      item_spacing: asNumber(spacing.item_spacing ?? source.item_spacing),
      margin_top: asNumber(spacing.margin_top ?? source.margin_top),
      margin_right: asNumber(spacing.margin_right ?? source.margin_right),
      margin_bottom: asNumber(spacing.margin_bottom ?? source.margin_bottom),
      margin_left: asNumber(spacing.margin_left ?? source.margin_left),
    },
    sizing: {
      width: asNumber(sizing.width ?? source.width),
      height: asNumber(sizing.height ?? source.height),
      min_width: asNumber(sizing.min_width ?? source.min_width),
      max_width: asNumber(sizing.max_width ?? source.max_width),
      min_height: asNumber(sizing.min_height ?? source.min_height),
      max_height: asNumber(sizing.max_height ?? source.max_height),
    },
    radius: {
      top_left: asNumber(radius.top_left ?? source.radius_top_left ?? source.radius),
      top_right: asNumber(radius.top_right ?? source.radius_top_right ?? source.radius),
      bottom_right: asNumber(radius.bottom_right ?? source.radius_bottom_right ?? source.radius),
      bottom_left: asNumber(radius.bottom_left ?? source.radius_bottom_left ?? source.radius),
    },
    border: {
      width: asNumber(border.width ?? source.border_width),
      style: asText(border.style ?? source.border_style),
      color: asText(border.color ?? source.border_color),
    },
    typography: {
      font_family: asText(typography.font_family ?? source.font_family),
      font_size: asNumber(typography.font_size ?? source.font_size),
      font_weight: asNumber(typography.font_weight ?? source.font_weight),
      line_height: asNumber(typography.line_height ?? source.line_height),
      letter_spacing: asNumber(typography.letter_spacing ?? source.letter_spacing),
    },
  };
}

function buildNodeMap(nodes) {
  const map = new Map();
  for (const raw of asArray(nodes)) {
    const node = normalizeNode(raw);
    if (!node.id) continue;
    map.set(node.id, node);
  }
  return map;
}

function collectColorDiff(baseNode, candNode) {
  const fields = ["text", "background", "fill"];
  const fieldRatios = fields.map((field) => textDiffRatio(baseNode.color[field], candNode.color[field]));
  return { ratio: avg(fieldRatios), fields };
}

function collectSpacingDiff(baseNode, candNode) {
  const fields = [
    "padding_top",
    "padding_right",
    "padding_bottom",
    "padding_left",
    "item_spacing",
    "margin_top",
    "margin_right",
    "margin_bottom",
    "margin_left",
  ];
  const fieldRatios = fields.map((field) => numberDiffRatio(baseNode.spacing[field], candNode.spacing[field]));
  return { ratio: avg(fieldRatios), fields };
}

function collectSizingDiff(baseNode, candNode) {
  const fields = ["width", "height", "min_width", "max_width", "min_height", "max_height"];
  const fieldRatios = fields.map((field) => numberDiffRatio(baseNode.sizing[field], candNode.sizing[field]));
  return { ratio: avg(fieldRatios), fields };
}

function collectRadiusDiff(baseNode, candNode) {
  const fields = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const fieldRatios = fields.map((field) => numberDiffRatio(baseNode.radius[field], candNode.radius[field]));
  return { ratio: avg(fieldRatios), fields };
}

function collectBorderDiff(baseNode, candNode) {
  const numberFields = ["width"];
  const textFields = ["style", "color"];
  const ratios = [
    ...numberFields.map((field) => numberDiffRatio(baseNode.border[field], candNode.border[field])),
    ...textFields.map((field) => textDiffRatio(baseNode.border[field], candNode.border[field])),
  ];
  return { ratio: avg(ratios), fields: [...numberFields, ...textFields] };
}

function collectTypographyDiff(baseNode, candNode) {
  const numberFields = ["font_size", "font_weight", "line_height", "letter_spacing"];
  const textFields = ["font_family"];
  const ratios = [
    ...numberFields.map((field) => numberDiffRatio(baseNode.typography[field], candNode.typography[field])),
    ...textFields.map((field) => textDiffRatio(baseNode.typography[field], candNode.typography[field])),
  ];
  return { ratio: avg(ratios), fields: [...numberFields, ...textFields] };
}

function makeCategoryState() {
  return {
    ratio_samples: [],
    mismatches: [],
  };
}

function summarizeCategory(state) {
  const diffRatio = avg(state.ratio_samples);
  const score = Math.round((1 - diffRatio) * 10000) / 100;
  return {
    diff_ratio: diffRatio,
    score,
    mismatch_count: state.mismatches.length,
    mismatches: state.mismatches,
  };
}

function compareVisualDiff(baseline, candidate, { threshold = 95 } = {}) {
  const baseMap = buildNodeMap(baseline?.nodes);
  const candMap = buildNodeMap(candidate?.nodes);
  const categoryStates = {
    color: makeCategoryState(),
    spacing: makeCategoryState(),
    sizing: makeCategoryState(),
    radius: makeCategoryState(),
    border: makeCategoryState(),
    typography: makeCategoryState(),
  };
  const reasons = [];

  for (const [id, baseNode] of baseMap.entries()) {
    const candNode = candMap.get(id);
    if (!candNode) {
      const reason = { category: "sizing", reason_code: "missing_node", node_id: id };
      reasons.push(reason);
      categoryStates.sizing.ratio_samples.push(1);
      categoryStates.sizing.mismatches.push(reason);
      continue;
    }

    const collectors = {
      color: collectColorDiff,
      spacing: collectSpacingDiff,
      sizing: collectSizingDiff,
      radius: collectRadiusDiff,
      border: collectBorderDiff,
      typography: collectTypographyDiff,
    };

    for (const [category, collector] of Object.entries(collectors)) {
      const { ratio, fields } = collector(baseNode, candNode);
      categoryStates[category].ratio_samples.push(ratio);
      if (ratio > 0) {
        const reason = {
          category,
          reason_code: `${category}_changed`,
          node_id: id,
          fields,
          diff_ratio: ratio,
        };
        reasons.push(reason);
        categoryStates[category].mismatches.push(reason);
      }
    }
  }

  for (const [id] of candMap.entries()) {
    if (baseMap.has(id)) continue;
    const reason = { category: "sizing", reason_code: "extra_node", node_id: id };
    reasons.push(reason);
    categoryStates.sizing.ratio_samples.push(1);
    categoryStates.sizing.mismatches.push(reason);
  }

  const categories = {
    color: summarizeCategory(categoryStates.color),
    spacing: summarizeCategory(categoryStates.spacing),
    sizing: summarizeCategory(categoryStates.sizing),
    radius: summarizeCategory(categoryStates.radius),
    border: summarizeCategory(categoryStates.border),
    typography: summarizeCategory(categoryStates.typography),
  };

  const totalDiffRatio = avg([
    categories.color.diff_ratio,
    categories.spacing.diff_ratio,
    categories.sizing.diff_ratio,
    categories.radius.diff_ratio,
    categories.border.diff_ratio,
    categories.typography.diff_ratio,
  ]);
  const score = Math.round((1 - totalDiffRatio) * 10000) / 100;
  const pass = score >= threshold;
  const classifiedReasons = annotateReasons(reasons, "visual");

  return {
    threshold,
    score,
    pass,
    status: pass ? "good" : "bad",
    categories,
    counts: {
      baseline_nodes: baseMap.size,
      candidate_nodes: candMap.size,
      reasons: classifiedReasons.length,
      reason_types: summarizeByType(classifiedReasons),
      color_mismatches: categories.color.mismatch_count,
      spacing_mismatches: categories.spacing.mismatch_count,
      sizing_mismatches: categories.sizing.mismatch_count,
      radius_mismatches: categories.radius.mismatch_count,
      border_mismatches: categories.border.mismatch_count,
      typography_mismatches: categories.typography.mismatch_count,
    },
    reasons: classifiedReasons,
  };
}

module.exports = {
  compareVisualDiff,
};
