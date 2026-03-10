// src/audit/actions.js
// frozen audit action identifiers (SoT for audit action strings)
module.exports = Object.freeze({
  // Generic
  UNKNOWN: "unknown",

  // Projects
  PROJECT_CREATE: "project_create",
  PROJECT_UPDATE: "project_update",
  PROJECT_DELETE: "project_delete",

  // Runs
  RUN_CREATE: "run_create",
  RUN_START: "run_start",
  RUN_UPDATE: "run_update",
  RUN_DELETE: "run_delete",

  // Auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth_logout",

  // Artifacts
  ARTIFACT_CREATE: "artifact_create",
  ARTIFACT_DELETE: "artifact_delete",

  // Workspace
  WORKSPACE_SEARCH: "workspace.search",

  // OpenAI Assist
  AI_REQUESTED: "ai.requested",
  AI_COMPLETED: "ai.completed",
  AI_FAILED: "ai.failed",
  OPENAI_ASSIST_CALL: "openai.assist.call",
  SUMMARY_GENERATED: "summary.generated",
  ANALYSIS_GENERATED: "analysis.generated",
  TRANSLATION_GENERATED: "translation.generated",
  FAQ_QUERIED: "faq.queried",
  FAQ_ANSWERED: "faq.answered",
  FAQ_ESCALATED: "faq.escalated",
  FAQ_GUARDRAIL_APPLIED: "faq.guardrail_applied",
  AI_SUMMARY_REQUEST: "ai.summary.request",
  AI_ANALYSIS_REQUEST: "ai.analysis.request",
  AI_TRANSLATION_REQUEST: "ai.translation.request",
  FAQ_QUERY: "faq.query",
});
