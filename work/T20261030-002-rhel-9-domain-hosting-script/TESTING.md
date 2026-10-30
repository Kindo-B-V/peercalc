# Testing

- TicketID: T20261030-002
- Title: RHEL 9 domain hosting script
- Stage: test
- Description: Domain-input RHEL 9 Docker hosting with automatic HTTPS and production identity
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## 2026-10-30T14:52:12

Implemented Bash installer and isolated HTTPS Compose. Eight setup/config tests pass; real HTTPS PostgreSQL/Keycloak 26.8.1 login, secure cookies, ownership/origin protection, save/restore, native and genuine MDB exchange pass with a local CA. Reviewed env precedence, local Docker pinning and rerun preservation. Actual RHEL/SELinux/firewalld/public ACME requires target-server validation.

## Evidence

`node --test scripts/*.test.mjs`: 8 tests passed. Coverage includes Bash syntax,
domain/config injection, platform guard, immutable secrets, duplicate/partial
dotenv rejection, exported-variable precedence, fixed project identity and
the rendered network/cookie/identity configuration.

Official container entrypoints validated nginx environment substitution and
configuration; Caddy configuration validation passed. A fresh PostgreSQL 16 and
Keycloak 26.8.1 production-mode realm became healthy. The isolated HTTPS stack
passed actual login, secure/HttpOnly/host-only session cookies, save/edit/restore,
wrong-Origin rejection, identity spoof rejection, admin/master path blocking,
native/MDB exchange and browser reimport, with zero browser errors. TLS was
independently validated against the local CA, not globally ignored.

Only the test edge used `tls internal`; no external ACME request was made.
Generic local report: `/tmp/peercalc-hosting-https-verification.json`.
No private source estimate was used in hosting tests. Actual RHEL installation,
SELinux enforcing, firewalld integration and public DNS/ACME remain target-server
verification, explicitly documented in `docs/HOSTING_RHEL9.md`.
