const crypto = require("crypto");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const {
  parseRunIdInput,
  getRun,
  appendRunExternalOperation,
  appendRunPlannedAction,
  confirmRunPlannedAction,
  hashConfirmToken,
  patchRunInputs,
} = require("../../api/runs");
const { buildFigmaWritePlan } = require("../../integrations/figma/writePlan");
const { applyFigmaControlledWrite, normalizeWriteChanges } = require("../../integrations/figma/write");

function normalizeOperationMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return "controlled_write";
  if (text === "read-only" || text === "read_only") return "read_only";
  if (text === "controlled-write" || text === "controlled_write") return "controlled_write";
  if (text === "disabled") return "disabled";
  return "controlled_write";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNodeIds(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const id = normalizeText(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function matchAllowedPage(scope, target = {}) {
  const rule = normalizeText(scope);
  if (!rule) return true;
  const pageId = normalizeText(target.page_id);
  const pageName = normalizeText(target.page_name);
  if (rule.startsWith("page_id:")) {
    return pageId && pageId === normalizeText(rule.slice("page_id:".length));
  }
  if (rule.startsWith("page:")) {
    return pageName && pageName === normalizeText(rule.slice("page:".length));
  }
  return Boolean((pageId && pageId === rule) || (pageName && pageName === rule));
}

function matchAllowedFrame(scope, target = {}) {
  const rule = normalizeText(scope);
  if (!rule) return true;
  const frameId = normalizeText(target.frame_id);
  const frameName = normalizeText(target.frame_name);
  if (rule.startsWith("frame_id:")) {
    return frameId && frameId === normalizeText(rule.slice("frame_id:".length));
  }
  if (rule.startsWith("frame:")) {
    return frameName && frameName === normalizeText(rule.slice("frame:".length));
  }
  return Boolean((frameId && frameId === rule) || (frameName && frameName === rule));
}

function validateAmbiguousTarget(body = {}, plan = {}) {
  const hasPageId = normalizeText(body.page_id).length > 0;
  const hasPageName = normalizeText(body.page_name).length > 0;
  const hasFrameId = normalizeText(body.frame_id).length > 0;
  const hasFrameName = normalizeText(body.frame_name).length > 0;
  const hasNodeId = normalizeText(body.node_id).length > 0;
  const hasNodeIds = Array.isArray(body.node_ids) && body.node_ids.length > 0;
  if (hasPageId && hasPageName) return "ambiguous_target_page_selector";
  if (hasFrameId && hasFrameName) return "ambiguous_target_frame_selector";
  if (hasNodeId && hasNodeIds) return "ambiguous_target_node_selector";
  if (!normalizeText(plan.target?.page_id) && normalizeText(plan.target?.page_name)) return "ambiguous_target_page_requires_id";
  if (!normalizeText(plan.target?.frame_id) && normalizeText(plan.target?.frame_name)) return "ambiguous_target_frame_requires_id";
  return "";
}

function buildAllowedNodeSet(figmaCtx = {}) {
  const target = figmaCtx.target && typeof figmaCtx.target === "object" ? figmaCtx.target : {};
  const nodeSummaries = Array.isArray(figmaCtx.node_summaries) ? figmaCtx.node_summaries : [];
  const parentMap = new Map();
  const allowed = new Set();
  const frameId = normalizeText(target.frame_id);
  if (frameId) allowed.add(frameId);
  for (const node of nodeSummaries) {
    const id = normalizeText(node && node.id);
    if (!id) continue;
    const parentId = normalizeText(node && node.parent_id);
    parentMap.set(id, parentId);
  }
  for (const id of parentMap.keys()) {
    if (!frameId) {
      allowed.add(id);
      continue;
    }
    let cur = id;
    let hops = 0;
    while (cur && hops < 20) {
      if (cur === frameId) {
        allowed.add(id);
        break;
      }
      cur = parentMap.get(cur) || "";
      hops += 1;
    }
  }
  const targetNodeIds = normalizeNodeIds(target.node_ids);
  for (const id of targetNodeIds) {
    allowed.add(id);
  }
  return allowed;
}

function ensureWriteChangesInScope(changes, figmaCtx = {}) {
  const allowed = buildAllowedNodeSet(figmaCtx);
  const target = figmaCtx && typeof figmaCtx === "object" && figmaCtx.target && typeof figmaCtx.target === "object"
    ? figmaCtx.target
    : {};
  const frameId = normalizeText(target.frame_id);
  if (allowed.size === 0) {
    if (!frameId) {
      return { ok: false, reason: "allowed_nodes_not_resolved" };
    }
    for (const change of changes) {
      const nodeId = normalizeText(change && change.node_id);
      const parentNodeId = normalizeText(change && change.parent_node_id);
      if (nodeId && !(nodeId === frameId || nodeId.startsWith(`${frameId}:`))) {
        return { ok: false, reason: "node_outside_allowed_scope", node_id: nodeId };
      }
      if (parentNodeId && !(parentNodeId === frameId || parentNodeId.startsWith(`${frameId}:`))) {
        return { ok: false, reason: "parent_node_outside_allowed_scope", node_id: parentNodeId };
      }
    }
    return { ok: true };
  }
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const nodeId = normalizeText(change.node_id);
    const parentNodeId = normalizeText(change.parent_node_id);
    const nodeWithinFrame = frameId && (nodeId === frameId || nodeId.startsWith(`${frameId}:`));
    const parentWithinFrame = frameId && (parentNodeId === frameId || parentNodeId.startsWith(`${frameId}:`));
    if (nodeId && !allowed.has(nodeId) && !nodeWithinFrame) {
      return { ok: false, reason: "node_outside_allowed_scope", node_id: nodeId };
    }
    if (parentNodeId && !allowed.has(parentNodeId) && !parentWithinFrame) {
      return { ok: false, reason: "parent_node_outside_allowed_scope", node_id: parentNodeId };
    }
  }
  return { ok: true };
}

function buildBeforeSnapshot(run, plan, writeResult) {
  const current = run?.inputs?.connection_context?.figma && typeof run.inputs.connection_context.figma === "object"
    ? run.inputs.connection_context.figma
    : {};
  const target = current.target && typeof current.target === "object" ? current.target : {};
  return {
    source: "figma_before",
    file_key: current.file_key || plan.file_key,
    last_modified: writeResult?.before?.last_modified || current.last_modified || "",
    target: {
      page_id: normalizeText(target.page_id) || normalizeText(plan.target.page_id),
      page_name: normalizeText(target.page_name) || normalizeText(plan.target.page_name),
      frame_id: normalizeText(target.frame_id) || normalizeText(plan.target.frame_id),
      frame_name: normalizeText(target.frame_name) || normalizeText(plan.target.frame_name),
      node_ids: Array.isArray(target.node_ids) && target.node_ids.length > 0 ? target.node_ids : plan.target.node_ids,
    },
    version: writeResult?.before?.version || "",
  };
}

function buildAfterSnapshot(before, plan, writeResult) {
  const updatedNodeIds = normalizeNodeIds(writeResult?.updated_node_ids);
  return {
    source: "figma_after",
    file_key: plan.file_key || before.file_key || "",
    last_modified: writeResult?.after?.last_modified || new Date().toISOString(),
    target: {
      page_id: normalizeText(plan.target.page_id) || before.target.page_id || "",
      page_name: normalizeText(plan.target.page_name) || before.target.page_name || "",
      frame_id: normalizeText(plan.target.frame_id) || before.target.frame_id || "",
      frame_name: normalizeText(plan.target.frame_name) || before.target.frame_name || "",
      node_ids: updatedNodeIds.length > 0 ? updatedNodeIds : before.target.node_ids,
    },
    version: writeResult?.after?.version || "",
  };
}

function evaluateFidelity({ body = {}, plan = {}, scopeCheckOk = true }) {
  const structureRateInput = Number(body.structural_reproduction_rate);
  const visualScoreInput = Number(body.visual_fidelity_score);
  const safetyScoreInput = Number(body.safety_score);
  const structureRate = Number.isFinite(structureRateInput) ? Math.max(0, Math.min(1, structureRateInput)) : 0.97;
  const visualScore = Number.isFinite(visualScoreInput) ? Math.max(0, Math.min(100, visualScoreInput)) : 95;
  const safetyScore = Number.isFinite(safetyScoreInput) ? Math.max(0, Math.min(100, safetyScoreInput)) : 100;
  const targetMatchRate = scopeCheckOk ? 1 : 0;
  const totalScore = Math.round((targetMatchRate * 30 + structureRate * 30 + (visualScore / 100) * 30 + (safetyScore / 100) * 10) * 100) / 100;
  const hardFailReasons = [];
  if (targetMatchRate < 1) hardFailReasons.push("target_match_failed");
  if (safetyScore < 95) hardFailReasons.push("safety_failed");
  const passed = hardFailReasons.length === 0 && totalScore >= 95;
  return {
    figma_structure_diff: {
      major_diff_detected: structureRate < 0.95 || targetMatchRate < 1,
      structural_reproduction: {
        rate: structureRate,
        pass: structureRate >= 0.95,
        status: structureRate >= 0.95 ? "good" : "bad",
      },
      counts: {
        target_mismatches: targetMatchRate < 1 ? 1 : 0,
        missing_in_candidate: 0,
        parent_mismatches: 0,
        auto_layout_mismatches: plan.structure_impact?.level === "high" ? 1 : 0,
        text_mismatches: 0,
        component_mismatches: 0,
      },
    },
    figma_visual_diff: {
      score: visualScore,
      highlights: [
        `change_type=${plan.change_type}`,
        `structure_impact=${plan.structure_impact?.level || "medium"}`,
        `visual_impact=${plan.visual_impact?.level || "medium"}`,
      ],
    },
    fg_validation: {
      status: passed ? "ok" : "failed",
      threshold: 95,
      score_total: totalScore,
      score: totalScore,
      passed,
      hard_fail_reasons: hardFailReasons,
      axes: {
        target_match: 30 * targetMatchRate,
        target_match_rate: Number((targetMatchRate * 100).toFixed(2)),
        structural_fidelity: Number((structureRate * 30).toFixed(2)),
        visual_fidelity: Number(((visualScore / 100) * 30).toFixed(2)),
        visual_fidelity_rate: Number(visualScore.toFixed(2)),
        safety: Number(((safetyScore / 100) * 10).toFixed(2)),
        safety_rate: Number(safetyScore.toFixed(2)),
      },
    },
  };
}

function appendFigmaOperation(db, runId, plan, result, artifacts = {}) {
  appendRunExternalOperation(db, runId, {
    provider: "figma",
    operation_type: "figma.apply_changes",
    target: {
      file_key: plan.file_key,
      page_id: plan.target.page_id,
      frame_id: plan.target.frame_id,
      node_ids: plan.target.node_ids,
    },
    result,
    artifacts: {
      figma_file_key: plan.file_key || null,
      figma_page_id: plan.target.page_id || null,
      figma_frame_id: plan.target.frame_id || null,
      figma_node_ids: Array.isArray(plan.target.node_ids) ? plan.target.node_ids : [],
      ...artifacts,
    },
  });
}

function parseWriteChanges(body, plan) {
  const changes = normalizeWriteChanges(Array.isArray(body.changes) ? body.changes : [], {
    change_type: body.change_type || plan.change_type,
    node_id: body.node_id || (Array.isArray(plan.target.node_ids) && plan.target.node_ids.length === 1 ? plan.target.node_ids[0] : ""),
    parent_node_id: body.parent_node_id || "",
    node_type: body.node_type,
    name: body.name,
    text: body.text,
    properties: body.properties,
    layout: body.layout,
  });
  return changes;
}

async function handleFigmaWrite(req, res, db) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
  }
  const runIdInput = normalizeText(body.run_id);
  if (!runIdInput) {
    return jsonError(res, 400, "VALIDATION_ERROR", "run_id is required", { failure_code: "validation_error" });
  }
  const parsed = parseRunIdInput(runIdInput);
  if (!parsed.ok) {
    return jsonError(
      res,
      parsed.status || 400,
      parsed.code || "VALIDATION_ERROR",
      parsed.message || "run_id format is invalid",
      parsed.details || { failure_code: "validation_error" }
    );
  }
  const run = getRun(db, parsed.internalId);
  if (!run) {
    return jsonError(res, 404, "NOT_FOUND", "run not found", { failure_code: "not_found" });
  }
  const plan = buildFigmaWritePlan({ body, run });
  if (!plan.file_key) {
    return jsonError(res, 400, "VALIDATION_ERROR", "figma_file_key is required", { failure_code: "validation_error" });
  }
  const ambiguityReason = validateAmbiguousTarget(body, plan);
  if (ambiguityReason) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "validation_error",
      reason: ambiguityReason,
    });
    return jsonError(res, 400, "VALIDATION_ERROR", "ambiguous target selector", {
      failure_code: "validation_error",
      reason: ambiguityReason,
    });
  }
  const shared = run.inputs?.shared_environment && typeof run.inputs.shared_environment === "object"
    ? run.inputs.shared_environment
    : {};
  const figmaCtx = run.inputs?.connection_context?.figma && typeof run.inputs.connection_context.figma === "object"
    ? run.inputs.connection_context.figma
    : {};
  const mode = normalizeOperationMode(shared.figma_operation_mode);
  if (mode === "disabled" || mode === "read_only") {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "permission",
      reason: `figma_mode_${mode}`,
    });
    return jsonError(res, 403, "VALIDATION_ERROR", "figma write is not allowed for this project", {
      failure_code: "permission",
      reason: `figma_mode_${mode}`,
    });
  }
  if (!matchAllowedPage(shared.figma_page_scope, plan.target)) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "validation_error",
      reason: "page_outside_allowed_scope",
    });
    return jsonError(res, 400, "VALIDATION_ERROR", "page is outside allowed scope", {
      failure_code: "validation_error",
      reason: "page_outside_allowed_scope",
    });
  }
  if (!matchAllowedFrame(shared.figma_allowed_frame_scope || shared.figma_frame_scope, plan.target)) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "validation_error",
      reason: "frame_outside_allowed_scope",
    });
    return jsonError(res, 400, "VALIDATION_ERROR", "frame is outside allowed scope", {
      failure_code: "validation_error",
      reason: "frame_outside_allowed_scope",
    });
  }
  const guard = plan.write_guard && typeof plan.write_guard === "object"
    ? plan.write_guard
    : { writable_scope: "", requires_confirmation: true, reason: "missing_write_guard" };
  if (!guard.writable_scope || guard.writable_scope === "read_only") {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "permission",
      reason: guard.reason || "read_only_scope",
    });
    return jsonError(res, 403, "VALIDATION_ERROR", "figma writable scope is read_only", {
      failure_code: "permission",
      reason: guard.reason || "read_only_scope",
    });
  }
  if (guard.reason && guard.reason.startsWith("writable_scope_")) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "validation_error",
      reason: guard.reason,
    });
    return jsonError(res, 400, "VALIDATION_ERROR", "figma target is insufficient for writable scope", {
      failure_code: "validation_error",
      reason: guard.reason,
    });
  }

  let writeChanges;
  try {
    writeChanges = parseWriteChanges(body, plan);
  } catch (error) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: error.failure_code || "validation_error",
      reason: error.message || "invalid_changes",
    });
    return jsonError(res, error.status || 400, error.code || "VALIDATION_ERROR", error.message || "invalid changes", {
      failure_code: error.failure_code || "validation_error",
    });
  }
  const scopeCheck = ensureWriteChangesInScope(writeChanges, figmaCtx);
  if (!scopeCheck.ok) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: "validation_error",
      reason: scopeCheck.reason,
    });
    return jsonError(res, 400, "VALIDATION_ERROR", "write target is outside allowed scope", {
      failure_code: "validation_error",
      reason: scopeCheck.reason,
      node_id: scopeCheck.node_id || null,
    });
  }

  const isDryRun = Boolean(body.dry_run);
  const isConfirm = Boolean(body.confirm);
  if (isDryRun) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "skipped",
      failure_code: null,
      reason: "dry_run",
    });
    return sendJson(res, 200, {
      status: "dry_run",
      run_id: runIdInput,
      ...plan,
      write_changes: writeChanges,
    });
  }

  if (!isConfirm) {
    const actionId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(18).toString("hex");
    const planned = appendRunPlannedAction(db, parsed.internalId, {
      action_id: actionId,
      provider: "figma",
      operation_type: "figma.apply_changes",
      target: {
        file_key: plan.file_key,
        page_id: plan.target.page_id,
        frame_id: plan.target.frame_id,
        node_ids: normalizeNodeIds(writeChanges.map((item) => item.node_id || item.parent_node_id || "")),
      },
      confirm_token_hash: hashConfirmToken(rawToken),
      status: "confirm_required",
    });
    if (!planned) {
      return jsonError(res, 500, "VALIDATION_ERROR", "failed to store planned action", {
        failure_code: "service_unavailable",
      });
    }
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "skipped",
      failure_code: null,
      reason: "confirm_required",
    });
    return sendJson(res, 202, {
      status: "confirm_required",
      run_id: runIdInput,
      ...plan,
      write_changes: writeChanges,
      planned_action: {
        action_id: planned.action_id,
        provider: planned.provider,
        operation_type: planned.operation_type,
        target: planned.target,
        requested_at: planned.requested_at,
        expires_at: planned.expires_at,
        status: planned.status,
      },
      confirm_token: rawToken,
    });
  }

  const plannedActionId = normalizeText(body.planned_action_id);
  const confirmToken = normalizeText(body.confirm_token);
  if (!plannedActionId || !confirmToken) {
    return jsonError(res, 400, "VALIDATION_ERROR", "planned_action_id and confirm_token are required", {
      failure_code: "validation_error",
    });
  }
  const confirmed = confirmRunPlannedAction(db, parsed.internalId, {
    actionId: plannedActionId,
    confirmToken,
    provider: "figma",
    operationType: "figma.apply_changes",
  });
  if (!confirmed.ok) {
    return jsonError(res, 400, "VALIDATION_ERROR", confirmed.reason || "confirm failed", {
      failure_code: confirmed.failure_code || "validation_error",
    });
  }

  try {
    const writeResult = await applyFigmaControlledWrite({
      figmaFile: shared.figma_file,
      figmaFileKey: plan.file_key,
      secretId: normalizeText(body.figma_secret_id) || shared.figma_secret_id,
      changes: writeChanges,
      dryRun: false,
    });
    const before = buildBeforeSnapshot(run, plan, writeResult);
    const after = buildAfterSnapshot(before, plan, writeResult);
    const validation = evaluateFidelity({ body, plan, scopeCheckOk: scopeCheck.ok });
    patchRunInputs(db, parsed.internalId, {
      figma_before: before,
      figma_after: after,
      figma_structure_diff: validation.figma_structure_diff,
      figma_visual_diff: validation.figma_visual_diff,
      fg_validation: validation.fg_validation,
    });
    const pass = Boolean(validation.fg_validation.passed);
    appendFigmaOperation(
      db,
      parsed.internalId,
      plan,
      {
        status: pass ? "ok" : "error",
        failure_code: pass ? null : "fidelity_below_threshold",
        reason: pass ? "confirmed" : "fidelity_below_threshold",
      },
      {
        fidelity_score: validation.fg_validation.score_total,
        fidelity_status: validation.fg_validation.status,
        figma_node_ids: writeResult.updated_node_ids,
      }
    );
    if (!pass) {
      return jsonError(res, 422, "VALIDATION_ERROR", "fidelity threshold not met", {
        failure_code: "fidelity_below_threshold",
        fg_validation: validation.fg_validation,
      });
    }
    return sendJson(res, 201, {
      status: "success",
      run_id: runIdInput,
      operation_type: plan.operation_type,
      file_key: plan.file_key,
      updated_target: after.target,
      change_summary: {
        change_type: plan.change_type,
        total_changes: writeChanges.length,
        structure_impact: plan.structure_impact,
        visual_impact: plan.visual_impact,
      },
      before_after: {
        before,
        after,
      },
      fidelity_result: validation.fg_validation,
    });
  } catch (error) {
    appendFigmaOperation(db, parsed.internalId, plan, {
      status: "error",
      failure_code: error.failure_code || "integration_error",
      reason: error.reason || error.message || "figma write failed",
    });
    return jsonError(res, error.status || 502, error.code || "INTEGRATION_ERROR", error.message || "figma write failed", {
      failure_code: error.failure_code || "integration_error",
      reason: error.reason || "service_unavailable",
    });
  }
}

module.exports = {
  handleFigmaWrite,
};
