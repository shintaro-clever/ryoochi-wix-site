function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTarget(target) {
  const source = target && typeof target === "object" ? target : {};
  return {
    page_id: asText(source.page?.id || source.page_id),
    page_name: asText(source.page?.name || source.page_name),
    frame_id: asText(source.frame?.id || source.frame_id),
    frame_name: asText(source.frame?.name || source.frame_name),
    node_ids: asArray(source.node_ids).map((item) => asText(item)).filter(Boolean),
  };
}

function normalizeNode(node) {
  const source = node && typeof node === "object" ? node : {};
  const component = source.component && typeof source.component === "object" ? source.component : {};
  const autoLayout = source.auto_layout && typeof source.auto_layout === "object" ? source.auto_layout : {};
  return {
    id: asText(source.id),
    type: asText(source.type),
    name: asText(source.name),
    parent_id: asText(source.parent_id),
    text: source.text === null || source.text === undefined ? null : String(source.text),
    component: {
      kind: asText(component.kind),
      key: asText(component.key),
      ref_id: asText(component.ref_id),
    },
    auto_layout: {
      layout_mode: asText(autoLayout.layout_mode),
      primary_axis_sizing_mode: asText(autoLayout.primary_axis_sizing_mode),
      counter_axis_sizing_mode: asText(autoLayout.counter_axis_sizing_mode),
      primary_axis_align_items: asText(autoLayout.primary_axis_align_items),
      counter_axis_align_items: asText(autoLayout.counter_axis_align_items),
      layout_wrap: asText(autoLayout.layout_wrap),
      layout_positioning: asText(autoLayout.layout_positioning),
    },
  };
}

function listTargetMismatches(baseTarget, candTarget) {
  const out = [];
  const fields = ["page_id", "page_name", "frame_id", "frame_name"];
  for (const field of fields) {
    if ((baseTarget[field] || "") !== (candTarget[field] || "")) {
      out.push({
        kind: "target",
        field,
        baseline: baseTarget[field] || "",
        candidate: candTarget[field] || "",
      });
    }
  }
  const baseNodeIds = new Set(baseTarget.node_ids);
  const candNodeIds = new Set(candTarget.node_ids);
  for (const id of baseNodeIds) {
    if (!candNodeIds.has(id)) {
      out.push({ kind: "target", field: "node_ids", baseline: id, candidate: "" });
    }
  }
  for (const id of candNodeIds) {
    if (!baseNodeIds.has(id)) {
      out.push({ kind: "target", field: "node_ids", baseline: "", candidate: id });
    }
  }
  return out;
}

function indexNodes(nodes) {
  const map = new Map();
  for (const raw of asArray(nodes)) {
    const node = normalizeNode(raw);
    if (!node.id) continue;
    map.set(node.id, node);
  }
  return map;
}

function compareNodePairs(baseMap, candMap) {
  const missing_in_candidate = [];
  const extra_in_candidate = [];
  const parent_mismatches = [];
  const text_mismatches = [];
  const auto_layout_mismatches = [];
  const component_mismatches = [];

  for (const [id, baseNode] of baseMap.entries()) {
    const candNode = candMap.get(id);
    if (!candNode) {
      missing_in_candidate.push(id);
      continue;
    }
    if ((baseNode.parent_id || "") !== (candNode.parent_id || "")) {
      parent_mismatches.push({ node_id: id, baseline: baseNode.parent_id || "", candidate: candNode.parent_id || "" });
    }
    if (baseNode.type === "TEXT" && baseNode.text !== candNode.text) {
      text_mismatches.push({ node_id: id, baseline: baseNode.text || "", candidate: candNode.text || "" });
    }
    const autoFields = [
      "layout_mode",
      "primary_axis_sizing_mode",
      "counter_axis_sizing_mode",
      "primary_axis_align_items",
      "counter_axis_align_items",
      "layout_wrap",
      "layout_positioning",
    ];
    const changedAutoFields = autoFields.filter(
      (field) => (baseNode.auto_layout[field] || "") !== (candNode.auto_layout[field] || "")
    );
    if (changedAutoFields.length > 0) {
      auto_layout_mismatches.push({ node_id: id, fields: changedAutoFields });
    }
    if (
      (baseNode.component.kind || "") !== (candNode.component.kind || "") ||
      (baseNode.component.key || "") !== (candNode.component.key || "")
    ) {
      component_mismatches.push({
        node_id: id,
        baseline: { kind: baseNode.component.kind || "", key: baseNode.component.key || "" },
        candidate: { kind: candNode.component.kind || "", key: candNode.component.key || "" },
      });
    }
  }
  for (const id of candMap.keys()) {
    if (!baseMap.has(id)) {
      extra_in_candidate.push(id);
    }
  }
  return {
    missing_in_candidate,
    extra_in_candidate,
    parent_mismatches,
    text_mismatches,
    auto_layout_mismatches,
    component_mismatches,
  };
}

function computeStructuralRate(baseNodeCount, pairDiff) {
  const denominator = Math.max(baseNodeCount, 1);
  const weightedMismatch =
    pairDiff.missing_in_candidate.length * 4 +
    pairDiff.extra_in_candidate.length * 2 +
    pairDiff.parent_mismatches.length * 2 +
    pairDiff.auto_layout_mismatches.length +
    pairDiff.text_mismatches.length +
    pairDiff.component_mismatches.length;
  const raw = 1 - weightedMismatch / (denominator * 4);
  return Math.max(0, Math.min(1, raw));
}

function compareFigmaStructure(baseline, candidate, { threshold = 0.95 } = {}) {
  const baseTarget = normalizeTarget(baseline?.target_resolution || baseline?.target || {});
  const candTarget = normalizeTarget(candidate?.target_resolution || candidate?.target || {});
  const target_mismatches = listTargetMismatches(baseTarget, candTarget);

  const baseMap = indexNodes(baseline?.nodes);
  const candMap = indexNodes(candidate?.nodes);
  const pairDiff = compareNodePairs(baseMap, candMap);

  const structure_rate = computeStructuralRate(baseMap.size, pairDiff);
  const major_diff_detected =
    target_mismatches.length > 0 ||
    pairDiff.missing_in_candidate.length > 0 ||
    pairDiff.parent_mismatches.length > 0;
  const pass = !major_diff_detected && structure_rate >= threshold;

  return {
    threshold,
    major_diff_detected,
    structural_reproduction: {
      rate: structure_rate,
      pass,
      status: pass ? "good" : "bad",
    },
    diffs: {
      target_mismatches,
      missing_in_candidate: pairDiff.missing_in_candidate,
      extra_in_candidate: pairDiff.extra_in_candidate,
      parent_mismatches: pairDiff.parent_mismatches,
      auto_layout_mismatches: pairDiff.auto_layout_mismatches,
      text_mismatches: pairDiff.text_mismatches,
      component_mismatches: pairDiff.component_mismatches,
    },
    counts: {
      baseline_nodes: baseMap.size,
      candidate_nodes: candMap.size,
      target_mismatches: target_mismatches.length,
      missing_in_candidate: pairDiff.missing_in_candidate.length,
      extra_in_candidate: pairDiff.extra_in_candidate.length,
      parent_mismatches: pairDiff.parent_mismatches.length,
      auto_layout_mismatches: pairDiff.auto_layout_mismatches.length,
      text_mismatches: pairDiff.text_mismatches.length,
      component_mismatches: pairDiff.component_mismatches.length,
    },
  };
}

module.exports = {
  compareFigmaStructure,
};
