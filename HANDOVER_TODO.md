# OpenClaw Manager Handover TODO

Date: 2026-03-27
Repo: /home/leonard/openclaw-manager

## Done This Session

1. Security default binding fix
- Added startup binding guard so the manager defaults to `127.0.0.1` in code.
- Non-loopback bind without `MANAGER_ALLOWED_IPS` now fails fast unless `MANAGER_ALLOW_UNSAFE_BIND=1` is set.
- Updated `start-manager.sh`, `ecosystem.config.js`, README, and added startup tests.

2. Single-project path performance fix
- Added `buildProjectListItem(...)` so single-project routes no longer rebuild the full project list.
- Updated these paths to use single-project projection:
  - `GET /api/projects/:id`
  - project action response payloads
  - model update response payloads
  - memory-mode update response payloads
  - template apply response payloads
  - Telegram `/status`
- Added regression tests proving unrelated broken projects no longer break single-project responses.

3. Broken config diagnostics fix
- Added shared config inspection helper for read/parse/validation failures.
- `GET /api/projects` and `GET /api/projects/:id` now show `healthStatus: unhealthy` plus `configIssues` for invalid JSON / unreadable config files.
- `managed_openclaw` start now fails fast with a clear preflight error instead of silently degrading to `unknown`.
- Added API tests for both list diagnostics and managed start failure on invalid JSON.

## Verified

- `npm test` passed: 41/41
- `npm run typecheck` passed
- `npm run build` passed
- `pm2 restart openclaw-manager` completed successfully
- Post-restart API checks passed:
  - `GET /api/health`
  - `GET /api/projects`
  - `GET /api/projects/:id`
- Temporary validation project `diag-broken-config-temp` was created and deleted during verification.
- No production OpenClaw instances were started, stopped, or restarted as part of the verification flow.

## Current Runtime Note

- `openclaw-manager` is PM2-managed.
- The manager was restarted during this session to load the latest build.
- Because PM2 is currently running with `HOST=0.0.0.0`, the live process is still LAN-visible behind the existing IP allowlist.
- If PM2 env is changed later, use `pm2 restart openclaw-manager --update-env` or reload from `ecosystem.config.js` with env update.

## Highest-Priority Remaining Work

1. Reduce `/api/projects` full-list cost
- The list route still probes every project and reads multiple config-derived profiles on every request.
- If project count grows, this remains the main scalability bottleneck.
- Recommended next step:
  - add a cached runtime snapshot layer for list responses, or
  - split summary/list from deep per-project metadata, or
  - add background probing instead of synchronous request-time probing.

2. Refactor the web app state container
- `apps/web/src/App.tsx` is still too large and mixes fetch logic, selection state, panel state, and mutation flow.
- Recommended next step:
  - extract a data/controller layer,
  - split editor/detail/bulk state into focused hooks or components,
  - add web-side tests before larger UI changes.

3. Add application-layer auth
- IP allowlist is helpful but not sufficient as the only protection for a control plane.
- Recommended next step:
  - add manager auth for browser/API access,
  - keep IP allowlist as defense in depth,
  - define a safe story for Telegram bot and reverse proxy access.

## Lower-Priority Follow-Ups

1. Normalize health endpoint naming
- Current manager health endpoint is `GET /api/health`.
- Some earlier manual checks assumed `/healthz`; docs and tooling should stay consistent.

2. Add deployment notes for PM2 env behavior
- PM2 restart does not automatically pick up changed env vars without `--update-env`.
- This can cause confusion when code defaults change but runtime behavior does not.

3. Add explicit regression coverage for PM2/deployed startup behavior
- Current tests cover API and startup helper logic, but not the PM2 deployment wrapper end to end.

## Clean-Up / Commit Notes

- The repo already had unrelated local modifications before and during this session.
- Do not assume the current git diff only contains the three fixes above.
- Before committing, review the full diff carefully and split unrelated work if needed.
