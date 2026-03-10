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

  // Phase6 RBAC
  ORG_MEMBER_CREATE: "org.member.create",
  ORG_MEMBER_ROLE_UPDATE: "org.member.role_update",
  ORG_INVITE_CREATE: "org.invite.create",
  ORG_INVITE_REVOKE: "org.invite.revoke",
  ORG_ROLE_UPSERT: "org.role.upsert",
  CONNECTION_LIFECYCLE_ADD: "connection.lifecycle.add",
  CONNECTION_LIFECYCLE_REAUTH: "connection.lifecycle.reauth",
  CONNECTION_LIFECYCLE_DISABLE: "connection.lifecycle.disable",
  CONNECTION_LIFECYCLE_DELETE: "connection.lifecycle.delete",
  CONNECTION_POLICY_UPDATE: "connection.policy.update",
  KNOWLEDGE_SOURCE_POLICY_UPDATE: "knowledge.source.policy.update",
  LANGUAGE_POLICY_UPDATE: "language.policy.update",
});
