# Decision Policy

## Why
Decisions made only in chat are not durable and not reviewable.
This policy forces decisions to be stored where the work is tracked: GitHub Issues.

## Rule
All decisions must be written to the linked Issue in the `Decision` section (or as a clearly labeled comment).

## Format (required)
Write decisions in the following minimal format:

Decision:
- <what we decided>

Reason:
- <why we decided it>

Impact:
- <what changes because of this decision>
- <what is explicitly NOT changing>

Links:
- Figma: <url>
- PR (if any): <url>

## Examples
Decision:
- Use backend-calculated rollups instead of frontend-only computation

Reason:
- Data sources will increase; backend becomes the stable contract

Impact:
- API response includes rollup fields
- Frontend renders values only (no derived rollups)
- Existing UI remains unchanged

Links:
- Figma: ...
- PR: ...
