# FairFare Browser Worker — START HERE

The Replit project is a pnpm workspace. Its API implementation is in `artifacts/api-server`, while the original interactive worker is kept at `artifacts/api-server/worker/browser-worker.js`.

## Run and test

From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
```

The Replit `artifacts/api-server: API Server` workflow runs the API on its configured port. The protected routes require `WORKER_SERVICE_TOKEN` in Replit Secrets. Check `GET /api/healthz` for process health. After setting or changing the secret, restart the workflow.

The API creates in-memory, manual-only jobs. A successful create returns `not-verified`; it does not launch Browserbase or confirm an Uber sign-in.

## Interactive worker

To use the preserved manual flow, set `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and `BROWSERBASE_CONTEXT_ID` in Replit Secrets, then run:

```sh
pnpm --filter @workspace/api-server run verify-session
```

Use the Live View privately and enter any login information yourself. The worker does not automate passwords, verification codes, or login. The API does not start this worker.

## Recovery and limitations

Read `PROJECT-STATUS.md`, `CURRENT-CAPABILITIES.md`, `TEST-RESULTS.md`, and `SECRETS-SETUP.md` in this directory before making changes. Job data and the context mutex are process-local; jobs disappear on restart and multiple API instances are unsafe for one shared context. The Browserbase context and sign-in state are external and are not part of the source archive.
