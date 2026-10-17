# Secrets setup

Store real values in Replit Secrets only. Never put them in source files, checkpoint ZIPs, browser-side JavaScript, or chat.

## API

- `WORKER_SERVICE_TOKEN` — required for protected session-check routes; the API returns 503 until a value of at least 32 non-whitespace characters is configured. Use a cryptographically random token and pass it only from trusted server-side code.

If the API returns `503 service_not_configured`, replace this secret with a valid generated value using the secure Secrets flow.

If generating the value in a local/Replit Shell, this prints a fresh 32-byte random token to that terminal; copy it directly into Replit Secrets and never into chat or source control:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Interactive Browserbase CLI

- `BROWSERBASE_API_KEY` — required only for the preserved manual CLI. Rotate any key that was previously exposed.
- `BROWSERBASE_PROJECT_ID` and `BROWSERBASE_CONTEXT_ID` — required only by the CLI; the non-secret example values are in `.env.example`.

The HTTP API does not use Browserbase credentials and never starts the CLI. Browserbase context state and cookies are external and not included in checkpoint archives.

`FAIRFARE_API_KEY` and `SESSION_SECRET` are not used by this project.
