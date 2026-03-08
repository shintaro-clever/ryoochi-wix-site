# Next Phase Backlog: Multi AI Connections + Role Routing (SoT)

Status: Deferred backlog (NEXT1-00, lower priority).  
Phase2 (external operations) and Phase3 (workspace hardening) scopes remain unchanged (`default AI = 1`).

## Scope (Next Phase)
- Personal AI Settings: manage multiple AI connections per user.
- Role Settings: assign AI preferences by role/profile/persona.
- Workspace/Run: route chat/run by role and record selection trace.

## Non-Scope (Current Phase)
- No multi-AI execution/routing implementation.
- No role-based UI/automation implementation.
- Keep current behavior: one default AI setting per user.

## Priority Guardrail (SoT)
- Do not pull this backlog into Phase2 Done criteria.
- Do not pull this backlog into Phase3 start order (`search -> history -> observability -> operability`).
- Treat this track as post-Phase3 unless explicitly re-prioritized by SoT update.

## Candidate Tasks
1. Data model: add role-to-ai_setting mapping tables.
2. API: role settings CRUD for personal configuration.
3. Runtime: selection policy (`primary`, `fallback`) and trace fields.
4. UI: role selector and connection matrix in user settings.
5. Observability: expose role/selection trace in run detail and audits.
