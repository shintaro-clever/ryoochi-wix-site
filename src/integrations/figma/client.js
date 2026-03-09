const https = require("https");

function integrationError(message, { status = 502, reason = "service_unavailable", providerStatus = null } = {}) {
  const err = new Error(message || "figma integration failed");
  err.status = status;
  err.code = "INTEGRATION_ERROR";
  err.failure_code = "integration_error";
  err.reason = reason;
  err.provider_status = providerStatus;
  return err;
}

function validationError(message) {
  const err = new Error(message || "validation failed");
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function resolveFigmaToken(secretId) {
  const ref = typeof secretId === "string" ? secretId.trim() : "";
  if (ref) {
    if (!ref.startsWith("env://")) {
      throw validationError("figma_secret_id must be resolvable (use env://<ENV_NAME>)");
    }
    const envName = ref.slice("env://".length).trim();
    if (!envName) {
      throw validationError("figma_secret_id env reference is invalid");
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(envName)) {
      throw validationError("figma_secret_id env reference name is invalid");
    }
    const value = typeof process.env[envName] === "string" ? process.env[envName].trim() : "";
    if (!value) {
      throw validationError(`figma secret env is missing: ${envName}`);
    }
    return value;
  }
  const fallback = typeof process.env.FIGMA_TOKEN === "string" ? process.env.FIGMA_TOKEN.trim() : "";
  if (!fallback) {
    throw validationError("figma_secret_id is required or set FIGMA_TOKEN");
  }
  return fallback;
}

function parseFigmaFileKey({ figmaFileKey = "", figmaFile = "" } = {}) {
  const key = typeof figmaFileKey === "string" ? figmaFileKey.trim() : "";
  if (key) return key;
  const text = typeof figmaFile === "string" ? figmaFile.trim() : "";
  if (!text) {
    throw validationError("figma_file_key is required");
  }
  const rawKey = text.match(/\/(?:file|design)\/([A-Za-z0-9]{10,})/);
  if (rawKey && rawKey[1]) return rawKey[1];
  if (/^[A-Za-z0-9]{10,}$/.test(text)) return text;
  throw validationError("figma_file is invalid");
}

function requestFigma({ method = "GET", path, token, timeoutMs = 10000, body = null }) {
  return new Promise((resolve, reject) => {
    const hasBody = body && typeof body === "object";
    const bodyText = hasBody ? JSON.stringify(body) : "";
    const req = https.request(
      {
        protocol: "https:",
        hostname: "api.figma.com",
        method,
        path,
        headers: {
          "X-Figma-Token": token,
          Accept: "application/json",
          "User-Agent": "figma-ai-github-workflow",
          ...(hasBody
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyText),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const status = res.statusCode || 500;
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch {
              json = null;
            }
          }
          if (status >= 200 && status < 300) {
            return resolve({ status, json, raw });
          }
          if (status === 401 || status === 403) {
            return reject(
              integrationError("figma permission denied", {
                status: 403,
                reason: "permission_denied",
                providerStatus: status,
              })
            );
          }
          if (status === 404) {
            return reject(
              integrationError("figma resource not found", {
                status: 404,
                reason: "not_found",
                providerStatus: status,
              })
            );
          }
          return reject(
            integrationError("figma service unavailable", {
              status: 502,
              reason: "service_unavailable",
              providerStatus: status,
            })
          );
        });
      }
    );
    req.on("error", () => {
      reject(integrationError("figma service unavailable", { status: 503, reason: "service_unavailable" }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
      reject(integrationError("figma request timeout", { status: 504, reason: "service_unavailable" }));
    });
    if (hasBody) {
      req.write(bodyText);
    }
    req.end();
  });
}

function normalizeNodeIdList(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function buildTreeIndexes(root) {
  const byId = new Map();
  const parentById = new Map();
  const pages = [];
  const frames = [];

  function walk(node, parentId = null, pageId = null, depth = 0) {
    if (!node || typeof node !== "object") return;
    if (depth > 100) return;
    const id = typeof node.id === "string" ? node.id : "";
    const type = typeof node.type === "string" ? node.type : "";
    if (id) {
      byId.set(id, node);
      parentById.set(id, parentId);
      if (type === "CANVAS") {
        pages.push({
          id,
          name: typeof node.name === "string" ? node.name : "",
          child_count: Array.isArray(node.children) ? node.children.length : 0,
        });
        pageId = id;
      }
      if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"].includes(type)) {
        frames.push({
          id,
          name: typeof node.name === "string" ? node.name : "",
          type,
          page_id: pageId,
          parent_id: parentId,
        });
      }
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child, id || null, pageId, depth + 1);
    }
  }

  walk(root, null, null);
  return { byId, parentById, pages, frames };
}

function findUniqueByName(list, name, entityName) {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text) return null;
  const matched = list.filter((item) => item && item.name === text);
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    throw validationError(`${entityName}_name is ambiguous`);
  }
  throw validationError(`${entityName}_name not found`);
}

function findNodePageId({ indexes, nodeId }) {
  const text = typeof nodeId === "string" ? nodeId.trim() : "";
  if (!text) return "";
  let cursor = text;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const current = indexes.byId.get(cursor);
    if (!current || typeof current !== "object") break;
    if (current.type === "CANVAS") return cursor;
    const parentId = indexes.parentById.get(cursor);
    cursor = typeof parentId === "string" ? parentId : "";
  }
  return "";
}

function isNodeWithinAncestor({ indexes, nodeId, ancestorId }) {
  const nodeText = typeof nodeId === "string" ? nodeId.trim() : "";
  const ancestorText = typeof ancestorId === "string" ? ancestorId.trim() : "";
  if (!nodeText || !ancestorText) return false;
  let cursor = nodeText;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorText) return true;
    seen.add(cursor);
    const parentId = indexes.parentById.get(cursor);
    cursor = typeof parentId === "string" ? parentId : "";
  }
  return false;
}

function resolveComparisonTarget({ selectedNodeIds, resolvedFrame, resolvedPage }) {
  if (selectedNodeIds.length > 0) {
    return {
      mode: "node",
      id: `node:${selectedNodeIds.slice().sort().join(",")}`,
    };
  }
  if (resolvedFrame && resolvedFrame.id) {
    return {
      mode: "frame",
      id: `frame:${resolvedFrame.id}`,
    };
  }
  if (resolvedPage && resolvedPage.id) {
    return {
      mode: "page",
      id: `page:${resolvedPage.id}`,
    };
  }
  return {
    mode: "file",
    id: "file:*",
  };
}

function resolveTargets({ pages, frames, pageId, pageName, frameId, frameName, nodeIds, nodeId }) {
  const requestedPageId = typeof pageId === "string" ? pageId.trim() : "";
  const requestedPageName = typeof pageName === "string" ? pageName.trim() : "";
  const requestedFrameId = typeof frameId === "string" ? frameId.trim() : "";
  const requestedFrameName = typeof frameName === "string" ? frameName.trim() : "";
  const requestedNodeId = typeof nodeId === "string" ? nodeId.trim() : "";
  const hasNodeIdsArray = Array.isArray(nodeIds);
  const resolvedNodeIds = normalizeNodeIdList(
    hasNodeIdsArray
      ? nodeIds
      : requestedNodeId
        ? [requestedNodeId]
        : []
  );
  if (requestedPageId && requestedPageName) {
    throw validationError("ambiguous target: page_id and page_name cannot be used together");
  }
  if (requestedFrameId && requestedFrameName) {
    throw validationError("ambiguous target: frame_id and frame_name cannot be used together");
  }
  if (requestedNodeId && hasNodeIdsArray && normalizeNodeIdList(nodeIds).length > 0) {
    throw validationError("ambiguous target: node_id and node_ids cannot be used together");
  }
  if (!requestedFrameId && requestedFrameName && !requestedPageId && !requestedPageName) {
    throw validationError("frame_name requires page_id or page_name");
  }
  let resolvedPage = null;
  if (requestedPageId) {
    resolvedPage = pages.find((item) => item.id === requestedPageId) || null;
    if (!resolvedPage) throw validationError("page_id not found");
  } else if (requestedPageName) {
    resolvedPage = findUniqueByName(pages, requestedPageName, "page");
  }

  let resolvedFrame = null;
  const frameCandidates = resolvedPage ? frames.filter((item) => item.page_id === resolvedPage.id) : frames;
  if (requestedFrameId) {
    resolvedFrame = frameCandidates.find((item) => item.id === requestedFrameId) || null;
    if (!resolvedFrame) throw validationError("frame_id not found");
  } else if (requestedFrameName) {
    resolvedFrame = findUniqueByName(frameCandidates, requestedFrameName, "frame");
  }

  return { resolvedPage, resolvedFrame, resolvedNodeIds };
}

function collectSubtreeNodeIds(rootNode) {
  const ids = [];
  const seen = new Set();
  function walk(node, depth = 0) {
    if (!node || typeof node !== "object") return;
    if (depth > 100) return;
    const id = typeof node.id === "string" ? node.id : "";
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child, depth + 1);
  }
  walk(rootNode);
  return ids;
}

function extractNodeSummary(node, parentId) {
  const type = typeof node?.type === "string" ? node.type : "";
  const bb = node && typeof node.absoluteBoundingBox === "object" ? node.absoluteBoundingBox : {};
  const isText = type === "TEXT";
  const componentKind =
    type === "COMPONENT"
      ? "component"
      : type === "COMPONENT_SET"
        ? "component_set"
        : type === "INSTANCE"
          ? "instance"
          : "none";
  return {
    id: typeof node?.id === "string" ? node.id : "",
    type,
    name: typeof node?.name === "string" ? node.name : "",
    parent_id: parentId || null,
    text: isText ? (typeof node?.characters === "string" ? node.characters : "") : null,
    component: {
      kind: componentKind,
      key:
        typeof node?.key === "string"
          ? node.key
          : typeof node?.componentKey === "string"
            ? node.componentKey
            : null,
      ref_id: typeof node?.componentId === "string" ? node.componentId : null,
      variant:
        node?.variantProperties && typeof node.variantProperties === "object" ? node.variantProperties : null,
    },
    auto_layout: {
      layout_mode: typeof node?.layoutMode === "string" ? node.layoutMode : null,
      primary_axis_sizing_mode:
        typeof node?.primaryAxisSizingMode === "string" ? node.primaryAxisSizingMode : null,
      counter_axis_sizing_mode:
        typeof node?.counterAxisSizingMode === "string" ? node.counterAxisSizingMode : null,
      primary_axis_align_items:
        typeof node?.primaryAxisAlignItems === "string" ? node.primaryAxisAlignItems : null,
      counter_axis_align_items:
        typeof node?.counterAxisAlignItems === "string" ? node.counterAxisAlignItems : null,
      layout_wrap: typeof node?.layoutWrap === "string" ? node.layoutWrap : null,
      layout_positioning: typeof node?.layoutPositioning === "string" ? node.layoutPositioning : null,
    },
    sizing_spacing: {
      width: typeof bb?.width === "number" ? bb.width : typeof node?.width === "number" ? node.width : null,
      height: typeof bb?.height === "number" ? bb.height : typeof node?.height === "number" ? node.height : null,
      min_width: typeof node?.minWidth === "number" ? node.minWidth : null,
      max_width: typeof node?.maxWidth === "number" ? node.maxWidth : null,
      min_height: typeof node?.minHeight === "number" ? node.minHeight : null,
      max_height: typeof node?.maxHeight === "number" ? node.maxHeight : null,
      padding: {
        left: typeof node?.paddingLeft === "number" ? node.paddingLeft : null,
        right: typeof node?.paddingRight === "number" ? node.paddingRight : null,
        top: typeof node?.paddingTop === "number" ? node.paddingTop : null,
        bottom: typeof node?.paddingBottom === "number" ? node.paddingBottom : null,
      },
      item_spacing: typeof node?.itemSpacing === "number" ? node.itemSpacing : null,
      counter_axis_spacing: typeof node?.counterAxisSpacing === "number" ? node.counterAxisSpacing : null,
      constraints: node?.constraints && typeof node.constraints === "object" ? node.constraints : null,
    },
  };
}

function summarizeNodes(nodeSummaries) {
  let textNodes = 0;
  let componentNodes = 0;
  let instanceNodes = 0;
  let autoLayoutNodes = 0;
  for (const node of nodeSummaries) {
    if (node.type === "TEXT") textNodes += 1;
    if (node.component.kind === "component" || node.component.kind === "component_set") componentNodes += 1;
    if (node.component.kind === "instance") instanceNodes += 1;
    if (node.auto_layout.layout_mode && node.auto_layout.layout_mode !== "NONE") autoLayoutNodes += 1;
  }
  return {
    node_count: nodeSummaries.length,
    text_node_count: textNodes,
    component_node_count: componentNodes,
    instance_node_count: instanceNodes,
    auto_layout_node_count: autoLayoutNodes,
  };
}

async function readFigmaFile({
  figmaFile = "",
  figmaFileKey = "",
  secretId = "",
  pageId = "",
  pageName = "",
  frameId = "",
  frameName = "",
  nodeIds = [],
  nodeId = "",
} = {}) {
  const token = resolveFigmaToken(secretId);
  const fileKey = parseFigmaFileKey({ figmaFileKey, figmaFile });
  const fileRes = await requestFigma({
    path: `/v1/files/${encodeURIComponent(fileKey)}`,
    token,
  });
  const root = fileRes.json?.document;
  if (!root || typeof root !== "object") {
    throw integrationError("figma file document not found", { status: 404, reason: "not_found" });
  }

  const indexes = buildTreeIndexes(root);
  let { resolvedPage, resolvedFrame, resolvedNodeIds } = resolveTargets({
    pages: indexes.pages,
    frames: indexes.frames,
    pageId,
    pageName,
    frameId,
    frameName,
    nodeIds,
    nodeId,
  });

  const selectedNodeIds = [];
  if (resolvedNodeIds.length > 0) {
    selectedNodeIds.push(...resolvedNodeIds);
  } else if (resolvedFrame) {
    const frameNode = indexes.byId.get(resolvedFrame.id);
    selectedNodeIds.push(...collectSubtreeNodeIds(frameNode));
  } else if (resolvedPage) {
    const pageNode = indexes.byId.get(resolvedPage.id);
    selectedNodeIds.push(...collectSubtreeNodeIds(pageNode));
  }

  const notIndexed = selectedNodeIds.filter((id) => !indexes.byId.has(id));
  if (notIndexed.length > 0) {
    const nodesRes = await requestFigma({
      path: `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(notIndexed.join(","))}`,
      token,
    });
    const nodesObj = nodesRes.json?.nodes && typeof nodesRes.json.nodes === "object" ? nodesRes.json.nodes : {};
    for (const id of notIndexed) {
      const doc = nodesObj[id]?.document;
      if (!doc || typeof doc !== "object") {
        throw integrationError("figma node not found", { status: 404, reason: "not_found" });
      }
      const newIndexes = buildTreeIndexes(doc);
      for (const [nodeIdKey, nodeValue] of newIndexes.byId.entries()) {
        if (!indexes.byId.has(nodeIdKey)) {
          indexes.byId.set(nodeIdKey, nodeValue);
        }
      }
      for (const [nodeIdKey, parentId] of newIndexes.parentById.entries()) {
        if (!indexes.parentById.has(nodeIdKey)) {
          indexes.parentById.set(nodeIdKey, parentId);
        }
      }
    }
  }

  const nodeSummaries = [];
  const missingNodeIds = [];
  for (const id of selectedNodeIds) {
    const node = indexes.byId.get(id);
    if (!node) {
      missingNodeIds.push(id);
      continue;
    }
    nodeSummaries.push(extractNodeSummary(node, indexes.parentById.get(id) || null));
  }
  if (missingNodeIds.length > 0) {
    throw integrationError("figma node not found", { status: 404, reason: "not_found" });
  }

  if (!resolvedPage && resolvedFrame && resolvedFrame.page_id) {
    resolvedPage = indexes.pages.find((item) => item.id === resolvedFrame.page_id) || null;
  }

  if (resolvedNodeIds.length > 0) {
    if (resolvedPage && resolvedPage.id) {
      const outOfPageNodeId = resolvedNodeIds.find(
        (id) => !isNodeWithinAncestor({ indexes, nodeId: id, ancestorId: resolvedPage.id })
      );
      if (outOfPageNodeId) {
        throw validationError("ambiguous target: node_ids must belong to the resolved page");
      }
    }
    if (resolvedFrame && resolvedFrame.id) {
      const outOfFrameNodeId = resolvedNodeIds.find(
        (id) => !isNodeWithinAncestor({ indexes, nodeId: id, ancestorId: resolvedFrame.id })
      );
      if (outOfFrameNodeId) {
        throw validationError("ambiguous target: node_ids must belong to the resolved frame");
      }
    }
  }

  if (!resolvedPage && resolvedNodeIds.length > 0) {
    const pageIds = new Set(
      resolvedNodeIds
        .map((id) => findNodePageId({ indexes, nodeId: id }))
        .filter((id) => typeof id === "string" && id)
    );
    if (pageIds.size > 1) {
      throw validationError("ambiguous target: node_ids span multiple pages");
    }
    if (pageIds.size === 1) {
      const [pageIdFromNodes] = Array.from(pageIds);
      resolvedPage = indexes.pages.find((item) => item.id === pageIdFromNodes) || null;
    }
  }

  const comparisonTarget = resolveComparisonTarget({
    selectedNodeIds,
    resolvedFrame,
    resolvedPage,
  });

  const nodesToSummarize =
    nodeSummaries.length > 0
      ? nodeSummaries
      : Array.from(indexes.byId.entries())
          .map(([id, node]) => extractNodeSummary(node, indexes.parentById.get(id) || null))
          .filter((item) => item.id && item.type !== "DOCUMENT" && item.type !== "CANVAS");

  return {
    file_key: fileKey,
    file: {
      name: typeof fileRes.json?.name === "string" ? fileRes.json.name : "",
      last_modified: typeof fileRes.json?.lastModified === "string" ? fileRes.json.lastModified : "",
      version: typeof fileRes.json?.version === "string" ? fileRes.json.version : "",
      editor_type: typeof fileRes.json?.editorType === "string" ? fileRes.json.editorType : "",
      thumbnail_url: typeof fileRes.json?.thumbnailUrl === "string" ? fileRes.json.thumbnailUrl : "",
      page_count: indexes.pages.length,
    },
    pages: indexes.pages,
    frames: indexes.frames,
    target_resolution: {
      page: resolvedPage ? { id: resolvedPage.id, name: resolvedPage.name } : null,
      frame: resolvedFrame ? { id: resolvedFrame.id, name: resolvedFrame.name, page_id: resolvedFrame.page_id } : null,
      node_ids: selectedNodeIds,
      comparison_target: {
        id: comparisonTarget.id,
        mode: comparisonTarget.mode,
      },
    },
    nodes: nodesToSummarize,
    summary: summarizeNodes(nodesToSummarize),
  };
}

module.exports = {
  readFigmaFile,
  integrationError,
  validationError,
  requestFigma,
  resolveFigmaToken,
  parseFigmaFileKey,
};
