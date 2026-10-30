# Triage

- TicketID: T20261030-004
- Title: Automatic free hosting backend port
- Stage: triage
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## 2026-10-30T16:01:30

User server already occupies80/443. Preserve existing webserver; auto choose first available loopback backend port from8788 and persist it, including Docker reservations. Use reverse-proxy Compose override without edge; public HTTPS domain/issuer unchanged and external routing clearly pending.
