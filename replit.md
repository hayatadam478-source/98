# FairFare Browser Worker

FairFare keeps a manual Browserbase session-verification worker and a small authenticated API for reporting verification jobs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/api-server run typecheck` — check API server and route types
- `pnpm --filter @workspace/api-server run test` — run local API tests and check the preserved worker's syntax
- `pnpm --filter @workspace/api-server run verify-session` — launch the original interactive worker; requires Browserbase secrets and a person using Live View
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret for protected session-check routes: `WORKER_SERVICE_TOKEN`
- Optional Browserbase secrets for the interactive CLI: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `BROWSERBASE_CONTEXT_ID`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- API contract: `lib/api-spec/openapi.yaml` (source of truth; regenerate with the codegen command above)
- API routes: `artifacts/api-server/src/routes/`
- Session job and context-lock logic: `artifacts/api-server/src/lib/session-check-service.ts`
- Preserved interactive worker: `artifacts/api-server/worker/browser-worker.js`
- Recovery documentation and secret setup: `artifacts/api-server/docs/fairfare/`
- Automated route tests: `artifacts/api-server/test/session-check.test.ts`

## Architecture decisions

- The HTTP API never starts Browserbase; its default job result is `not-verified` because verification requires a person in Live View.
- API job status is persisted in the existing PostgreSQL database. Terminal records expire after 15 minutes and the store is bounded to 1,000 jobs.
- PostgreSQL advisory locking coordinates session-check jobs across API instances. Startup recovery marks abandoned `running` rows as failed.
- Job records must remain limited to job/status/timestamp metadata and fixed result codes/messages; never add credentials, cookies, Live View URLs, or browser session data.
- Rate limiting remains process-local, so request limits can multiply across API instances.
- `WORKER_SERVICE_TOKEN` must remain server-side. Never place it in Hatchable browser JavaScript.
- The API does not modify or deploy the Hatchable site.

## Product

An operator-controlled Browserbase worker with a protected job API. It does not retrieve fares, book rides, handle payments, or automate Uber login.

## User preferences

- Preserve the existing worker; do not rebuild it unnecessarily.
- Do not automate passwords, verification codes, or logins.
- Do not add fare scraping, ride booking, or payment automation.
- Do not modify or deploy Hatchable without explicit authorization.

## Gotchas

- Keep generated API files synchronized with `lib/api-spec/openapi.yaml` by running codegen after contract changes.
- A `202` job is a record only; the current API does not start a real verification session.
- The development database schema is managed with `pnpm --filter @workspace/db run push`; do not use that command against production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
