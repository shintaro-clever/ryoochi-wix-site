"use strict";

const SEARCH_MODEL_VERSION = "phase3-search-model-v1";

const SEARCH_MODEL = Object.freeze({
  version: SEARCH_MODEL_VERSION,
  entities: Object.freeze([
    {
      entity: "project",
      searchable_fields: ["id", "name", "staging_url", "production_url", "created_at", "updated_at"],
      non_searchable_fields: ["auth.json", ".env", "secret values", "resolved secret bodies"],
    },
    {
      entity: "thread",
      searchable_fields: ["thread_id", "project_id", "title", "created_at", "updated_at"],
      non_searchable_fields: ["secret-like values inside message body", "confirm_token", "resolved secret bodies"],
    },
    {
      entity: "run",
      searchable_fields: [
        "run_id",
        "project_id",
        "thread_id",
        "status",
        "job_type",
        "run_mode",
        "failure_code",
        "target_path",
        "created_at",
        "updated_at",
      ],
      non_searchable_fields: ["raw secret payloads", "confirm_token", "secret_id resolved values"],
    },
    {
      entity: "message",
      searchable_fields: ["message_id", "thread_id", "role", "content (sanitized summary only)", "created_at"],
      non_searchable_fields: ["secret-like raw body", "token strings", "full hidden/private body"],
    },
    {
      entity: "external_operation",
      searchable_fields: [
        "provider",
        "operation_type",
        "target.repository",
        "target.branch",
        "target.path",
        "target.file_key",
        "result.status",
        "result.failure_code",
        "result.reason",
        "recorded_at",
      ],
      non_searchable_fields: ["confirm_token", "secret refs resolved values", "raw credentials"],
    },
    {
      entity: "external_audit",
      searchable_fields: [
        "actor.requested_by",
        "actor.ai_setting_id",
        "actor.thread_id",
        "scope.project_id",
        "scope.run_id",
        "scope.status",
        "read.plan_status",
        "read.targets.github",
        "read.targets.figma",
        "write_plan.provider",
        "write_plan.operation_type",
        "write_actual.result.status",
        "write_actual.result.failure_code",
        "figma_fidelity.status",
      ],
      non_searchable_fields: ["confirm_token", "secret_id resolved values", "secret-like raw text", "private hidden evidence body"],
    },
  ]),
  excluded_value_classes: Object.freeze([
    "secret-like values",
    "confirm_token",
    "secret_id resolved values",
    "raw credentials",
    "hidden/private body",
  ]),
});

module.exports = {
  SEARCH_MODEL_VERSION,
  SEARCH_MODEL,
};
