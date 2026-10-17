# FairFare Browser Worker — START HERE

The Replit project is a pnpm workspace. Its API implementation is in `artifacts/api-server`, while the original interactive worker is kept at `artifacts/api-server/worker/browser-worker.js`.

## Run and test

From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push # development database only, if schema is missing
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
```

The Replit `artifacts/api-server: API Server` workflow runs the API on its configured port. The protected routes require `WORKER_SERVICE_TOKEN` in Replit Secrets. Check `GET /api/healthz` for process health. After setting or changing the secret, restart the workflow.

The API stores job status in the existing PostgreSQL database. Completed records expire after 15 minutes, with a 1,000-job cap. A shared PostgreSQL advisory lock allows only one job at a time across API instances. On startup, abandoned `running` jobs are marked `failed` with `job_interrupted`. The default runner remains manual-only: a successful job ends as `not-verified`; it does not launch Browserbase or confirm an Uber sign-in.

## Interactive worker

To use the preserved manual flow, set `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and `BROWSERBASE_CONTEXT_ID` in Replit Secrets, then run:

```sh
pnpm --filter @workspace/api-server run verify-session
```

Use the Live View privately and enter any login information yourself. The worker does not automate passwords, verification codes, or login. The API does not start this worker.

## Recovery and limitations

Read `PROJECT-STATUS.md`, `CURRENT-CAPABILITIES.md`, `TEST-RESULTS.md`, and `SECRETS-SETUP.md` in this directory before making changes. Rate limiting remains per API process. The current API runner does not open a Browserbase session. Browserbase context and sign-in state are external and are not part of the source archive.
