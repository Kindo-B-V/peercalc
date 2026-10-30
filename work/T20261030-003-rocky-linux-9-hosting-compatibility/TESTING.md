# Testing

- TicketID: T20261030-003
- Title: Rocky Linux 9 hosting compatibility
- Stage: test
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

The actual official `rockylinux/rockylinux:9.5` container passed platform
detection. Its initial prerequisite transaction reproduced the curl-minimal
conflict. The corrected package helper has both installed/missing-curl
regressions; all 9 setup/configuration tests and ShellCheck error checks pass.
Remote CI for the first guard fix (`dc707e1`) passed; the subsequent package fix
is validated separately. No changes were made on the user's server.

## 2026-10-30T15:34:51

Accept Rocky Linux 9 explicitly alongside RHEL 9; keep official RHEL Docker repository per Rocky documentation. User Rocky 9.5 release fixture fails before and passes after. All eight setup/config tests and ShellCheck error checks pass. Other distributions and major versions remain rejected; no remote host changes performed.
