# Paste this into a new Replit AI chat

Continue FairFare Browser Worker in the pnpm workspace. Read `artifacts/api-server/docs/fairfare/START-HERE.md`, `PROJECT-STATUS.md`, `CURRENT-CAPABILITIES.md`, `TEST-RESULTS.md`, and `SECRETS-SETUP.md`. Preserve `artifacts/api-server/worker/browser-worker.js`; it is the original manual Browserbase worker. The API lives in the shared Express server and returns `not-verified` by default without starting a browser.

Run `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/api-server run test` before changes. Keep `WORKER_SERVICE_TOKEN` and Browserbase credentials in Replit Secrets only. Never place the service token in Hatchable browser code. Do not deploy or modify Hatchable without explicit authorization, and do not run a live Browserbase check without approval. Do not add fare scraping, ride booking, payments, or automated login.

After each successful milestone, update the status/capability/test docs, run relevant checks, commit a Git checkpoint, and create a lightweight project source ZIP excluding secrets, `.env`, `node_modules`, caches, browser binaries, cookies, browser storage, and Live View URLs. Clearly distinguish mock-only tests from live Browserbase verification.
