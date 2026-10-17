# FairFare Browser Worker API

This API package preserves FairFare's existing interactive Browserbase worker and adds authenticated session-check job endpoints to the shared Express API server.

## Routes

- `GET /api/healthz` — public health check.
- `POST /api/v1/session-check` — creates an in-memory job; requires `Authorization: Bearer <WORKER_SERVICE_TOKEN>`.
- `GET /api/v1/session-check/:jobId` — reads a job; requires the same bearer token.

The POST body may be omitted or be `{}`. Additional fields are rejected. Jobs finish as `not-verified` by default with `manual_interaction_required`. The API does not start Browserbase or confirm an Uber sign-in.

## Run and test

From the workspace root:

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run dev
```

Set `WORKER_SERVICE_TOKEN` in Replit Secrets before using protected routes. Never put it in browser-side code. The preserved CLI can be run separately with `pnpm --filter @workspace/api-server run verify-session`; it requires Browserbase secrets and manual Live View interaction.

See `docs/fairfare/START-HERE.md`, `SECRETS-SETUP.md`, `CURRENT-CAPABILITIES.md`, and `TEST-RESULTS.md` for restore instructions and verified limitations.
