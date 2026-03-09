"use strict";

const fs = require("fs");
const path = require("path");

function captureError(message, reason = "capture_failed") {
  const err = new Error(message || "capture failed");
  err.status = 502;
  err.code = "SERVICE_UNAVAILABLE";
  err.failure_code = "capture_failed";
  err.reason = reason;
  return err;
}

function validationError(message) {
  const err = new Error(message || "validation failed");
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function normalizeViewport(value) {
  const source = value && typeof value === "object" ? value : {};
  const width = Number(source.width);
  const height = Number(source.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw validationError("viewport width and height are required");
  }
  const safeWidth = Math.max(320, Math.min(4096, Math.round(width)));
  const safeHeight = Math.max(240, Math.min(4096, Math.round(height)));
  return { width: safeWidth, height: safeHeight };
}

function normalizeTargetUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw validationError("target_url is required");
  }
  if (!/^https?:\/\//i.test(text)) {
    throw validationError("target_url must be http(s)");
  }
  return text;
}

function ensureCapturePath(relativePath) {
  const text = typeof relativePath === "string" ? relativePath.trim().replace(/\\/g, "/") : "";
  if (!text || !text.startsWith(".ai-runs/")) {
    throw validationError("capture target path must be under .ai-runs/");
  }
  const absolute = path.join(process.cwd(), text);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

function writeMockPng(filePath) {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4BfV8AAAAASUVORK5CYII=";
  fs.writeFileSync(filePath, Buffer.from(tinyPngBase64, "base64"));
}

async function captureWithPlaywright({ url, viewport, outputPath, timeoutMs }) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    throw captureError("playwright is not installed", "capture_unavailable");
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.screenshot({ path: outputPath, fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
}

async function captureScreenshot({
  targetUrl,
  viewport,
  outputPath,
  timeoutMs = 20000,
} = {}) {
  if (process.env.CAPTURE_FORCE_FAIL === "1") {
    throw captureError("capture forced to fail", "capture_forced");
  }
  const normalizedUrl = normalizeTargetUrl(targetUrl);
  const normalizedViewport = normalizeViewport(viewport || {});
  const absoluteOutput = ensureCapturePath(outputPath);

  if (process.env.CAPTURE_MOCK === "1") {
    writeMockPng(absoluteOutput);
    return {
      ok: true,
      mode: "mock",
      output_path: outputPath,
      viewport: normalizedViewport,
      target_url: normalizedUrl,
    };
  }

  try {
    await captureWithPlaywright({
      url: normalizedUrl,
      viewport: normalizedViewport,
      outputPath: absoluteOutput,
      timeoutMs,
    });
    return {
      ok: true,
      mode: "playwright",
      output_path: outputPath,
      viewport: normalizedViewport,
      target_url: normalizedUrl,
    };
  } catch (error) {
    if (error && error.failure_code === "capture_failed") {
      throw error;
    }
    throw captureError(error && error.message ? error.message : "capture execution failed", "capture_execution_failed");
  }
}

module.exports = {
  captureScreenshot,
  captureError,
  validationError,
  normalizeViewport,
  normalizeTargetUrl,
};
