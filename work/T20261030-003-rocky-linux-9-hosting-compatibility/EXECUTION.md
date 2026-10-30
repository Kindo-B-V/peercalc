# Execution

- TicketID: T20261030-003
- Title: Rocky Linux 9 hosting compatibility
- Stage: execute
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## What Changed

The platform guard accepts Rocky Linux 9 as well as RHEL 9. Error output now
includes the detected distribution and version. Tests cover the user's 9.5
release fields, major-only Rocky 9, other Rocky versions and an unknown distro
with ID_LIKE=rhel. The script name and all deployment/data handling stay intact.

## Why This Fixes It

The user's ID is rocky, so the original exact ID=rhel comparison rejected a
compatible target before any installation. This explicit allowlist fixes that
case without disabling the safety boundary. The existing Docker repository is
also prescribed by the official Rocky Linux 9 Docker guide; no speculative
repository switch or uninstall is needed.

Code fix confirmed: Yes
