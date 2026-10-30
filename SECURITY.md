# Security and Operating Boundaries

The default Docker delivery is for local use. It binds only `127.0.0.1:8788`.
Do not change that to a public interface and treat it as production hosting.

The separate `compose.hosting.yaml` profile and `scripts/host-rhel9.sh` provide
a single-server HTTPS hosting baseline. They use automatic TLS, secure cookies,
production-mode Keycloak with PostgreSQL, closed registration and private
application ports. The admin/master realm routes are blocked at the public
gateway; administration is through SSH and the container's CLI. See
[RHEL 9 hosting](docs/HOSTING_RHEL9.md). This does not replace an operational
security assessment, backup/restore drills or dependency maintenance.

## Identity Boundary

Nginx asks OAuth2 Proxy to authenticate a session and replaces application
identity headers with validated OIDC claims. Ownership is keyed by Keycloak's
stable subject, never email or a browser-provided user ID. Every document,
version, restore, save, and deletion API enforces ownership. Cross-origin writes
are rejected. Direct Worker and converter ports are not published.

The standalone Worker expects a trusted gateway. Running it directly on an
untrusted network permits forged identity headers. The bare Vite development
server's simulated sign-in is a convenience, not authentication.

## Secrets and Local Data

Local setup generates unique secrets in mode-0600 `.env`, which Git ignores.
Hosting setup uses a separate mode-0600 `.env.hosting` and ignored `.hosting/`.
Never commit it, runtime `.dev.vars`, session cookies, or document volumes. Do
not attach customer files to public issues. The converter token is server-only.

Docker volumes and browser recovery drafts contain estimates in plaintext.
Use host disk encryption and appropriate local access controls. Clear local
drafts when finishing work on a shared browser.

## Before Internet Hosting

- Configure HTTPS, secure cookies, production Keycloak and an identity database.
- Configure verified registration, email, password recovery and account lifecycle rules.
- Restrict administration and keep internal service ports private.
- Define backup/restore drills, retention, object garbage collection and storage quotas.
- Add operating limits, monitoring, dependency review and a security assessment.
- Validate customer exchange fixtures in the originating WPCalc/BasCalc application.

Soft deletion retains history and objects; it is not a data-erasure promise.
Immutable revisions and schema migrations must not be rewritten for rollback.
Stop the stack before file-level backups of SQLite/Keycloak volumes, and retain
the private secrets needed to restore them.

The initial dependency review removed unused UI dependencies and upgraded the
runtime stack. Production-dependency npm audit is clean at implementation time.
The migration generator still pulls a moderate esbuild development-server
advisory through its deprecated loader; no esbuild development server is
started by this product. Recheck advisories before deploying any build tooling
or accepting new untrusted file-processing capabilities.
