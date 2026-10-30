# Execution

- TicketID: T20261030-002
- Title: RHEL 9 domain hosting script
- Stage: execute
- Description: Domain-input RHEL 9 Docker hosting with automatic HTTPS and production identity
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## Implementation

- Root: Bash installer, input/secrets tests, documentation, CI and integration.
- cloud_backend: production Compose, Caddy/nginx, PostgreSQL and Keycloak 26.8.1.
- workspace_ui: isolated real HTTPS browser acceptance using a local CA.
- format_core: installer review, Docker environment/context and SELinux checks.

The installer pins the local Docker socket and Compose project, rejects unsafe
domain/configuration input, clears exported hosting-variable overrides and never
rotates existing secrets. It installs Docker through the official RHEL package
repository without uninstalling existing runtimes, leaves SELinux enabled and
opens only HTTP/HTTPS services in an already-active firewalld default zone.

An initial HTTPS-origin concern was disproved using real wire-level Host and
X-Forwarded-Proto headers. The runtime already handles trusted proxy headers;
no application origin helper or unnecessary runtime binding was retained.

The local stack and private documents were not changed. Isolated test containers
and synthetic test volumes were removed after verification.
