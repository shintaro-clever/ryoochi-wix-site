# Fidelity Comparison Environments (P4-ENV-01)

## Purpose
- Fix comparison environments so fidelity checks can consistently detect production drift.
- Standardize comparison conditions for `localhost`, `staging`, and `production`.
- Operational verification flow is defined in `docs/runbooks/fidelity-hardening-operations.md`.

## Target Environments (Fixed)
- `localhost`
- `staging`
- `production`

`target_environment` must be one of the three values above and must be included in `compare_environments`.

## Fixed Comparison Conditions
The following conditions are mandatory and persisted in Run input/context:
- `url` (per environment)
- `viewport` (`preset`, `width`, `height`)
- `theme` (`light|dark|system`)
- `auth_state` (per environment: `anonymous|member|admin`)
- `fixture_data` (`mode`, `dataset_id`, `snapshot_id`, `seed`, `flags`)

## Resolution Rules
1. Environment set
- Read from `inputs.fidelity_environment`.
- If absent, defaults apply and all 3 environments are compared.

2. URL
- `localhost`: default `http://127.0.0.1:3000` if not overridden.
- `staging`: must be provided by `fidelity_environment.environments.staging.url` or shared environment.
- `production`: must be provided by `fidelity_environment.environments.production.url` or shared environment.
- If `staging` or `production` is included in `compare_environments` and URL is missing, return `validation_error`.

3. Viewport
- Presets:
  - `desktop` => `1440x900`
  - `tablet` => `768x1024`
  - `mobile` => `390x844`
- Custom viewport requires both `width` and `height`.

4. Theme
- Must be one of `light|dark|system`.

5. Auth State
- Must be one of `anonymous|member|admin`.
- Default:
  - `localhost=admin`
  - `staging=admin`
  - `production=anonymous`

6. Fixture Data
- Default:
  - `mode=seeded`
  - `dataset_id=baseline`
  - `snapshot_id=latest`
  - `seed=default`

## Run Persistence Contract
Persist in both:
- `inputs.fidelity_environment`
- `context_used.fidelity_environment`

Minimum shape:

```json
{
  "version": "p4-env-01",
  "target_environment": "staging",
  "compare_environments": ["localhost", "staging", "production"],
  "environments": {
    "localhost": { "name": "localhost", "url": "http://127.0.0.1:3000", "theme": "light", "auth_state": "admin" },
    "staging": { "name": "staging", "url": "https://staging.example.com", "theme": "light", "auth_state": "admin" },
    "production": { "name": "production", "url": "https://app.example.com", "theme": "light", "auth_state": "anonymous" }
  },
  "conditions": {
    "viewport": { "preset": "desktop", "width": 1440, "height": 900 },
    "theme": "light",
    "auth_state": { "localhost": "admin", "staging": "admin", "production": "anonymous" },
    "fixture_data": {
      "mode": "seeded",
      "dataset_id": "baseline",
      "snapshot_id": "latest",
      "seed": "default",
      "flags": {}
    }
  }
}
```

## Operational Expectations
- Use the fixed order `localhost -> staging -> production`.
- Keep `viewport`, `theme`, `auth_state`, and `fixture_data` identical across environments unless the test explicitly targets environment drift.
- If `environment_only_mismatch` is detected repeatedly, treat comparison-condition drift as the first suspect before changing code or design.
