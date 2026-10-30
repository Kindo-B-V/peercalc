# PeerCalc Web

For the complete local Docker setup, credentials, storage, and operating limits,
see the [project README](../README.md) and [security notes](../SECURITY.md).

## Source

- `components/peercalc/workspace.tsx`: estimating workspace and document operations.
- `src/domain`: LGPL calculation engine, native model, and WPCalc importer.
- `src/server` and `app/api`: owner-scoped persistence and converter proxy.
- `db` and `drizzle`: D1 metadata schema and immutable SQL migrations.
- `worker/index.ts`: Vinext/Cloudflare Worker entrypoint.
- `tests`: synthetic domain fixtures, real SQLite service tests, and browser acceptance tests.

## Commands

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The last command requires the root Docker stack. It reads local credentials from
the ignored root `.env` and uses isolated test-created records. Browser traces
are disabled so authentication secrets are not captured.

`npm run dev` runs a separate development preview with simulated loopback auth.
`npm start` runs the built Worker without an identity gateway; keep it on
loopback. Docker provides real OIDC and private persistent storage instead.

## Storage and Migrations

Generate schema changes with `npm run db:generate`, then inspect the generated
SQL. Never rewrite a migration already applied to a document volume. The Docker
entrypoint applies pending migrations and runs the Worker with `/data` as its
state directory. Local development state under `.wrangler/` is separate.

The optional `.openai/hosting.json` declares D1/R2 binding names. Its reserved
Site is not published by the local Docker workflow. The maintained Sites build
integration is retained for future cloud hosting, not required to use Docker.
