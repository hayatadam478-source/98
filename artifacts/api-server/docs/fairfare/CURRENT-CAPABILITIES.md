# Current capabilities — Checkpoint 06

## Available

- Original interactive Browserbase/Playwright CLI is preserved and remains a separate, manually run command.
- `GET /api/healthz` provides public process health.
- `POST /api/v1/session-check` and `GET /api/v1/session-check/:jobId` require a bearer token from Replit Secrets.
- The POST body is optional or `{}` only. Invalid content type, malformed JSON, extra fields, and oversized bodies receive safe JSON errors.
- Rate limiting defaults to 30 requests per minute per remote IP.
- A process-local mutex rejects a concurrent job with HTTP 409.
- Default jobs end as `not-verified` with `manual_interaction_required`; the API does not launch a browser.

## Not implemented or not verified

- Unattended session verification, durable jobs, or a distributed lock across API instances.
- Hatchable integration, deployment, or public production hardening.
- Fare scraping, ride booking, payments, or automated login/password/code entry.
- Fresh live Browserbase/Uber connectivity or persistent-context behavior in this checkpoint.

Checkpoint 05 includes historical manual verification results; they were not repeated here.
