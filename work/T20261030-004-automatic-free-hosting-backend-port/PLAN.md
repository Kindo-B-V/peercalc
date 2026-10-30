# Plan

- TicketID: T20261030-004
- Title: Automatic free hosting backend port
- Stage: plan
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## Implementation

1. Inspect listeners and Docker-published TCP ports without stopping services.
2. Preserve standalone hosting when its public ports are available or owned.
3. Otherwise persist the first free loopback port from 8788 and disable the edge
   using a separate Compose override. Keep the public HTTPS issuer unchanged.
4. Generate proxy examples without editing/reloading unknown existing servers.
5. Verify allocation, ownership, state/security, actual proxy-profile startup
   and external HTTPS browser workflows; commit and push.

Actual user proxy routing/certificates require its existing configuration and
remain explicitly pending, not substituted by unsafe public HTTP or port 444.
