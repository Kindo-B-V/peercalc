# Testing

- TicketID: T20261030-004
- Title: Automatic free hosting backend port
- Stage: test
- Description: -
- Status: Done
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## Verification

21 setup/port/configuration tests and ShellCheck error checks pass. A real
Rocky 9.5 container verified Bash port selection and owned-port persistence.
The isolated full proxy stack skipped occupied ports through 8791, selected
8792, started no Compose edge and bound only 127.0.0.1. The port survived gateway
recreation and existing synthetic secrets stayed unchanged.

A separate simulated HTTPS proxy using a validated local CA passed actual
login, secure cookies, save/edit/restore, native/MDB export/reimport, wrong-Origin
and identity-spoof rejection and admin/master path blocks. The existing dummy
proxy kept its ID, zero restarts and HTTP 200 on both reserved ports. No private
source file was used. The local app and other services were left untouched.

Generic artifact: `/tmp/peercalc-proxy-https-verification.json`. All isolated QA
resources were removed after verification. Actual public user proxy routing,
certificate configuration and RHEL host firewall/SELinux remain operator steps.

## Delivery Completion

All steps completed: Yes

Issue fully fixed in code: Yes

These statements cover automatic free-port selection and safe backend/proxy
mode delivery. The user's actual external proxy route is not claimed configured.
Source commit `3358643` passed [remote CI](https://github.com/Kindo-B-V/peercalc/actions/runs/41078629383),
including all 21 setup/port tests and the existing application/converter/browser
checks. No existing host webserver was stopped or reconfigured.

## 2026-10-30T16:12:16

Implemented automatic persistent loopback port8788+ fallback when80/443busy, with Docker-aware scans and preserved secrets/existingproxy.21 setup/port/config tests pass; Rocky9.5 helper check passes. Isolated real proxy-profile stack chose8792, no edge, loopback-only binding stable on recreation, dummyproxy unchanged; external simulated HTTPS login/save/restore/MDB exchange and spoof protections pass. Actual user proxy route is still manual/pending.

## 2026-10-30T16:16:57

Automatic first-free loopback backend selection, persistent port reuse and safe proxy override delivered.21 tests/ShellCheck/Rocky9.5 helper check pass; real isolated proxy-profile HTTPS/login/save/restore/MDB and unchanged existingproxy pass. CI3358643/run41078629383 passed. Actual user HTTPS-proxy domain route remains manual/pending; installer explicitly distinguishes backend ready from public TLS ready.
