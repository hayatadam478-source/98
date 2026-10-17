# FairFare Browser Worker API

This API package preserves FairFare's existing interactive Browserbase worker and adds authenticated session-check job endpoints to the shared Express API server.

## Routes

- `GET /api/healthz` — public health check.
- `POST /api/v1/session-check` — creates a persistent job; requires `Authorization: Bearer <WORKER_SERVICE_TOKEN>`.
- `GET /api/v1/session-check/:jobId` — reads a job; requires the same bearer token.

The POST body may be omitted or be `{}`. Additional fields are rejected. Job status is stored in the existing PostgreSQL database; completed records expire after 15 minutes. A PostgreSQL advisory lock prevents simultaneous session-check jobs across API instances. Abandoned jobs are marked `failed` on recovery. Job records do not contain credentials, cookies, Live View URLs, or browser session data.

Jobs finish as `not-verified` by default with `manual_interaction_required`. The API does not start Browserbase or confirm an Uber sign-in.

## Run and test

From the workspace root:

```sh
pnpm --filter @workspace/db run push # development database schema only
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run dev
```

Set `WORKER_SERVICE_TOKEN` in Replit Secrets before using protected routes. Never put it in browser-side code. The preserved CLI can be run separately with `pnpm --filter @workspace/api-server run verify-session`; it requires Browserbase secrets and manual Live View interaction.

The API requires the existing PostgreSQL database to be configured. Rate limiting remains process-local; only session-check concurrency is coordinated across API instances.

See `docs/fairfare/START-HERE.md`, `SECRETS-SETUP.md`, `CURRENT-CAPABILITIES.md`, and `TEST-RESULTS.md` for restore instructions and verified limitations.
