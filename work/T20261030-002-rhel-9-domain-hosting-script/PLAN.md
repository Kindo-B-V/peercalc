# Plan

- TicketID: T20261030-002
- Title: RHEL 9 domain hosting script
- Stage: plan
- Description: Domain-input RHEL 9 Docker hosting with automatic HTTPS and production identity
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## 2026-10-30T14:38:38

Keep local stack untouched; add isolated hosting Compose, persistent PostgreSQL identity, secure OIDC cookies, strict public origin and root Bash installer with preserved secrets, SELinux mounts and checks. No external Notion record is linked.

## Scope And Gates

1. Inspect the existing local trust boundary and official Docker/Keycloak/Caddy setup guidance.
2. Add a separate hosting profile, not a public binding on the local development profile.
3. Generate secrets once, validate the domain and preserve existing identity/document volumes.
4. Test shell/configuration, production PostgreSQL/Keycloak startup and actual HTTPS browser workflows in isolation.
5. Document server prerequisites and untested target-specific behavior; commit and push the source.

No actual RHEL server or domain credentials were provided. Do not install host
packages on the development machine, request public certificates for test domains,
migrate private estimates, or claim a remote deployment. Rollback preserves
volumes and secrets; no destructive cleanup of existing installations is allowed.
