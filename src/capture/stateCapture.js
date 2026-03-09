"use strict";

const { captureScreenshot } = require("./screenshot");

const DEFAULT_STATES = ["hover", "active", "disabled", "loading", "modal_open"];

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStates(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const state = asText(item).toLowerCase();
    if (!state || seen.has(state)) continue;
    seen.add(state);
    out.push(state);
  }
  return out.length > 0 ? out : DEFAULT_STATES.slice();
}

function buildStatePath(basePath, state) {
  const text = asText(basePath);
  if (!text.endsWith(".png")) return `${text}-${state}.png`;
  return text.replace(/\.png$/i, `-${state}.png`);
}

async function captureStates({
  targetUrl,
  viewport,
  baseOutputPath,
  states = [],
  timeoutMs = 20000,
} = {}) {
  const normalizedStates = normalizeStates(states);
  const results = [];
  for (const state of normalizedStates) {
    const outputPath = buildStatePath(baseOutputPath, state);
    try {
      const result = await captureScreenshot({
        targetUrl,
        viewport,
        outputPath,
        timeoutMs,
      });
      results.push({
        state,
        status: "ok",
        failure_code: null,
        artifact_path: outputPath,
        signature: `${state}:${result.mode}:${result.viewport.width}x${result.viewport.height}`,
      });
    } catch (error) {
      results.push({
        state,
        status: "error",
        failure_code: "capture_failed",
        reason: error && error.reason ? String(error.reason) : "capture_execution_failed",
        artifact_path: "",
        signature: "",
      });
    }
  }
  return {
    states: normalizedStates,
    results,
    success: results.every((row) => row.status === "ok"),
  };
}

module.exports = {
  captureStates,
  normalizeStates,
  DEFAULT_STATES,
};
