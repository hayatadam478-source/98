# Recovery verification — Checkpoint 08

- Source: the restored Checkpoint 07 workspace. The original interactive Browserbase worker remains unchanged.
- Added the `fairfare_session_check_jobs` table to the existing development PostgreSQL database with Drizzle. No production schema change was made.
- The table stores only a UUID job ID, status, timestamps, and fixed result code/message.
- Cross-instance single-job exclusion uses a PostgreSQL session advisory lock. The lock is held while the job runner is active and releases when the job finishes or its database connection closes.
- API startup acquires the context lock before marking stranded `running` records as `failed` with `job_interrupted`. If another instance owns the lock, startup recovery leaves its running job alone.
- API build completed and the managed API workflow restarted successfully. Startup completed and listened on port 8080.
- Full workspace typecheck passed. API test suite passed: 12 passed, 0 failed. The three database-backed tests cover persistence across recreated API servers, recovery of an interrupted job, and cross-instance lock contention.
- Live checks used `WORKER_SERVICE_TOKEN` through `replit secrets exec`; its value was not printed, logged, or included in this archive.
- Live health returned 200; unauthenticated create and status requests returned 401; authenticated create returned 202; status retrieval returned 200.
- A completed job was retrieved after a second API workflow restart, confirming live persistence.
- Live Browserbase/Uber session, Hatchable integration, and deployment: **not run**.
- The default API runner is still a simulation that returns `not-verified`; no browser session was opened.
