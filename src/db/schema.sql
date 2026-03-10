CREATE TABLE IF NOT EXISTS projects (
  tenant_id   TEXT NOT NULL DEFAULT 'internal',
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  staging_url TEXT NOT NULL,
  drive_folder_id TEXT,
  project_shared_env_json TEXT,
  project_bindings_json TEXT,
  project_drive_json TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS connections (
  tenant_id    TEXT NOT NULL DEFAULT 'internal',
  id           TEXT NOT NULL,
  provider     TEXT,
  provider_key TEXT,
  config_json  TEXT,
  scope_type   TEXT,
  scope_id     TEXT,
  status       TEXT,
  secret_ref   TEXT,
  policy_json  TEXT,
  disabled_at  TEXT,
  created_by   TEXT,
  updated_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
  tenant_id    TEXT NOT NULL DEFAULT 'internal',
  id           TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  thread_id    TEXT,
  ai_setting_id TEXT,
  status       TEXT NOT NULL,
  inputs_json  TEXT NOT NULL,
  failure_code TEXT,
  job_type     TEXT,
  target_path  TEXT,
  run_mode     TEXT,
  figma_file_key TEXT,
  ingest_artifact_path TEXT,
  github_pr_url TEXT,
  github_pr_number INTEGER,
  search_requested_by TEXT,
  search_provider TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS project_threads (
  tenant_id   TEXT NOT NULL DEFAULT 'internal',
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  tenant_id   TEXT NOT NULL DEFAULT 'internal',
  id          TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  role        TEXT,
  content     TEXT,
  run_id      TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS personal_ai_settings (
  tenant_id    TEXT NOT NULL DEFAULT 'internal',
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  secret_ref   TEXT,
  config_json  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS run_events (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  run_id     TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  actor_id   TEXT,
  action     TEXT NOT NULL,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  tenant_id   TEXT NOT NULL DEFAULT 'internal',
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS organization_roles (
  tenant_id         TEXT NOT NULL DEFAULT 'internal',
  id                TEXT NOT NULL,
  organization_id   TEXT NOT NULL,
  role_key          TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  permissions_json  TEXT NOT NULL,
  is_system         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, organization_id, role_key)
);

CREATE TABLE IF NOT EXISTS organization_members (
  tenant_id            TEXT NOT NULL DEFAULT 'internal',
  id                   TEXT NOT NULL,
  organization_id      TEXT NOT NULL,
  account_id           TEXT NOT NULL,
  email                TEXT,
  display_name         TEXT,
  status               TEXT NOT NULL,
  assigned_roles_json  TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, organization_id, account_id)
);

CREATE TABLE IF NOT EXISTS organization_invites (
  tenant_id             TEXT NOT NULL DEFAULT 'internal',
  id                    TEXT NOT NULL,
  organization_id       TEXT NOT NULL,
  email                 TEXT NOT NULL,
  account_id            TEXT,
  invited_by            TEXT,
  proposed_roles_json   TEXT NOT NULL,
  status                TEXT NOT NULL,
  expires_at            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS faq_knowledge_source_policies (
  tenant_id        TEXT NOT NULL DEFAULT 'internal',
  source_path      TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  priority         INTEGER NOT NULL DEFAULT 100,
  audiences_json   TEXT NOT NULL,
  public_scope     TEXT NOT NULL DEFAULT 'both',
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source_path)
);

CREATE TABLE IF NOT EXISTS organization_language_policies (
  tenant_id                  TEXT NOT NULL DEFAULT 'internal',
  organization_id            TEXT NOT NULL,
  default_language           TEXT NOT NULL DEFAULT 'ja',
  supported_languages_json   TEXT NOT NULL,
  glossary_mode              TEXT NOT NULL DEFAULT 'managed_terms_locked',
  glossary_path              TEXT NOT NULL DEFAULT 'docs/i18n/glossary.md',
  updated_at                 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS audit_logs_action_created
  ON audit_logs(tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS organizations_slug
  ON organizations(tenant_id, slug);

CREATE INDEX IF NOT EXISTS organization_roles_org_updated
  ON organization_roles(tenant_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS organization_members_org_updated
  ON organization_members(tenant_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS organization_invites_org_updated
  ON organization_invites(tenant_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS faq_knowledge_source_policies_priority
  ON faq_knowledge_source_policies(tenant_id, enabled, priority ASC, updated_at DESC);

CREATE INDEX IF NOT EXISTS organization_language_policies_updated
  ON organization_language_policies(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_templates (
  name                  TEXT NOT NULL,
  direction             TEXT NOT NULL,
  required_mode         TEXT NOT NULL,
  required_capabilities TEXT NOT NULL,
  required_inputs       TEXT NOT NULL,
  description           TEXT,
  PRIMARY KEY (name)
);

CREATE INDEX IF NOT EXISTS runs_project_status
  ON runs(tenant_id, project_id, status);

CREATE INDEX IF NOT EXISTS runs_status_created
  ON runs(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS project_threads_project_updated
  ON project_threads(tenant_id, project_id, updated_at);

CREATE INDEX IF NOT EXISTS project_threads_project_created
  ON project_threads(tenant_id, project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS thread_messages_thread_created
  ON thread_messages(tenant_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS personal_ai_settings_user
  ON personal_ai_settings(tenant_id, user_id, updated_at DESC);
