# Connectors / Connections API Schema (SoT)

Issue: #65 (P2-04)  
Scope: `GET /api/connectors`, `GET /api/connections`

## Schema Version

- Current: `schema_version = "1.0"`
- Policy:
  - Backward-compatible additive changes: keep major (`1.x`)
  - Breaking changes (remove/rename/type-change): bump major and update selftest in same PR

## Security Policy (Secrets)

- Secret values must not be returned by API.
- API exposes only metadata:
  - `has_secret` (boolean)
  - `secret_len` (number, 0 when missing)
- `notes` may include presence/LEN text, but never raw token/key values.

## GET /api/connectors

Response: array of connector rows.

Required row fields:

| key | type | nullable | note |
|---|---|---|---|
| schema_version | string | no | current `1.0` |
| id | string | no | connector id |
| key | string | no | provider key |
| name | string | no | display name |
| enabled | boolean | no | connector enabled state |
| connected | boolean | no | token/key configured state |
| last_checked_at | string \| null | yes | ISO timestamp |
| has_secret | boolean | no | secret presence only |
| secret_len | number | no | secret length only |
| notes | string[] | no | non-secret notes |

Optional existing catalog fields may appear and remain backward-compatible.

## GET /api/connections

Response: object.

Required top-level fields:

| key | type | nullable | note |
|---|---|---|---|
| schema_version | string | no | current `1.0` |
| updated_at | string \| null | yes | ISO timestamp |
| items | array | no | same row schema as `/api/connectors` |

Compatibility fields (existing UI support, secret-masked):

- `ai.provider`: string
- `ai.name`: string
- `ai.apiKey`: empty string
- `github.repo`: string
- `github.token`: empty string
- `figma.fileUrl`: string
- `figma.token`: empty string

## Compatibility Policy

- Keep existing fields used by Hub UI (`ai/github/figma`) to avoid regressions.
- New fields can be added; existing required fields must not be removed or have type changes without major bump + selftest update.
