"use strict";

const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun, appendRunExternalOperation } = require("../../src/api/runs");
const { assert } = require("./_helpers");

function hasIndex(dbHandle, tableName, indexName) {
  return dbHandle.prepare(`PRAGMA index_list(${tableName})`).all().some((row) => row.name === indexName);
}

function explainUsesIndex(dbHandle, sql, params, expectedIndex) {
  const rows = dbHandle.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
  return rows.some((row) => String(row.detail || "").includes(expectedIndex));
}

async function run() {
  const projectId = crypto.randomUUID();
  const threadId = crypto.randomUUID();
  const runId = createRun(db, {
    project_id: projectId,
    thread_id: threadId,
    job_type: "workspace.search.indexing",
    run_mode: "mcp",
    target_path: "src/index.js",
    status: "queued",
    inputs: {
      requested_by: "search-index-tester",
    },
  });

  try {
    appendRunExternalOperation(db, runId, {
      provider: "github",
      operation_type: "github.write_plan",
      target: { repository: "octocat/hello-world", path: "src/index.js" },
      result: { status: "skipped", reason: "confirm_required" },
    });

    const runRow = db
      .prepare("SELECT search_requested_by, search_provider FROM runs WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, runId);
    assert(runRow, "run helper columns should be queryable");
    assert(runRow.search_requested_by === "search-index-tester", "search_requested_by should be populated");
    assert(runRow.search_provider === "github", "search_provider should track latest provider");

    assert(hasIndex(db, "runs", "runs_project_thread_created"), "runs_project_thread_created index should exist");
    assert(hasIndex(db, "runs", "runs_thread_created"), "runs_thread_created index should exist");
    assert(hasIndex(db, "runs", "runs_status_created"), "runs_status_created index should exist");
    assert(hasIndex(db, "runs", "runs_search_requested_by_created"), "runs_search_requested_by_created index should exist");
    assert(hasIndex(db, "runs", "runs_search_provider_created"), "runs_search_provider_created index should exist");
    assert(hasIndex(db, "project_threads", "project_threads_project_created"), "project_threads_project_created index should exist");
    assert(hasIndex(db, "thread_messages", "thread_messages_thread_run_created"), "thread_messages_thread_run_created index should exist");
    assert(hasIndex(db, "thread_messages", "thread_messages_run_created"), "thread_messages_run_created index should exist");

    assert(
      explainUsesIndex(
        db,
        "SELECT id FROM runs WHERE tenant_id=? AND project_id=? AND thread_id=? ORDER BY created_at DESC LIMIT 20",
        [DEFAULT_TENANT, projectId, threadId],
        "runs_project_thread_created"
      ),
      "project/thread run search should use runs_project_thread_created"
    );
    assert(
      explainUsesIndex(
        db,
        "SELECT id FROM runs WHERE tenant_id=? AND status=? ORDER BY created_at DESC LIMIT 20",
        [DEFAULT_TENANT, "queued"],
        "runs_status_created"
      ),
      "status run search should use runs_status_created"
    );
    assert(
      explainUsesIndex(
        db,
        "SELECT id FROM runs WHERE tenant_id=? AND search_provider=? ORDER BY created_at DESC LIMIT 20",
        [DEFAULT_TENANT, "github"],
        "runs_search_provider_created"
      ),
      "provider search should use runs_search_provider_created"
    );
  } finally {
    db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, threadId);
    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);
  }
}

module.exports = { run };
