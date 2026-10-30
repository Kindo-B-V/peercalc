# Execution

- TicketID: T20261030-004
- Title: Automatic free hosting backend port
- Stage: execute
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## What Changed

Added Docker-aware TCP allocation/persistent deployment state, a proxy Compose
override, installer integration, generated nginx/Caddy examples and tests/docs.
The override starts seven core services with only the gateway bound to loopback;
the standalone Caddy edge is inactive. Existing credentials/volumes are reused.

## Why This Fixes It

Occupied public ports no longer abort installation or cause another webserver
to be stopped. The backend scans upward and reuses its owned port on reruns.
The existing proxy can retain HTTPS on 443 and route the domain to the backend;
OIDC issuer/cookies/origin checks stay correct. Unknown proxy configuration is
not modified and backend readiness is not presented as public TLS completion.

Code fix confirmed: Yes
