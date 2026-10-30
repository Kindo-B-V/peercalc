# Testing

- TicketID: T20261030-001
- Title: PeerCalc cloud calculation workspace
- Stage: test
- Description: Open-source browser estimating with native and legacy exchange, local Docker authentication, durable storage and versioning
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## 2026-10-30T12:15:14

Local Docker stack running with real Keycloak sign-in, persistent D1/R2, Java MDB converter; auditing format fidelity, browser flows and owner isolation

## 2026-10-30T12:36:49

Docker OIDC/storage/versioning verified; 7 browser workflows and 20,000-row editing pass. Private user file import matches saved totals, hours and resource columns; source-preserving export verification in progress. No external Notion record identified or modified.

## Final Local Acceptance

56 domain/live-converter, 6 storage/API, 21 Java, 8 browser, and 1 credential
setup tests pass. TypeScript and Docker build/startup/Compose validation pass.
Production dependencies have zero reported vulnerabilities. The private
browser export independently preserves all 13 MDB tables and 46,054 fields
outside 27 documented derived-cache/timestamp changes, with no unexpected drift.

Private exports remain ignored with mode 0600. Public documentation uses only
synthetic screenshots. Windows WPCalc application-level readback and advanced
legacy mappings remain open; see ACCEPTANCE.md and converter/FORMAT.md.
