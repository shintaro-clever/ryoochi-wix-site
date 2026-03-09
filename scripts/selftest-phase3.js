#!/usr/bin/env node
"use strict";

const path = require("path");

const PHASE3_TESTS = [
  "p3_phase_boundary_sot.test.js",
  "p3_search_model.test.js",
  "p3_workspace_search_api.test.js",
  "p3_workspace_search_audit.test.js",
  "p3_workspace_search_indexing.test.js",
  "p3_history_api.test.js",
  "p3_workspace_metrics_api.test.js",
  "p3_run_retry_api.test.js",
  "p3_workspace_export_api.test.js",
  "p3_secret_masking.test.js",
  "p3_workspace_search_ui.test.js",
];

async function main() {
  for (const name of PHASE3_TESTS) {
    const filePath = path.join(__dirname, "..", "tests", "selftest", name);
    const mod = require(filePath);
    if (!mod || typeof mod.run !== "function") {
      throw new Error(`[p3 selftest] invalid module: ${name}`);
    }
    process.stdout.write(`[p3 selftest] START ${name}\n`);
    try {
      await mod.run();
      process.stdout.write(`[p3 selftest] OK ${name}\n`);
    } catch (error) {
      process.stdout.write(`[p3 selftest] FAIL ${name}\n`);
      throw error;
    }
  }
  process.stdout.write("[p3 selftest] ok\n");
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
