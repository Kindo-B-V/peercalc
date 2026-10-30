# Plan

- TicketID: T20261030-003
- Title: Rocky Linux 9 hosting compatibility
- Stage: plan
- Description: -
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

Keep the existing script name and Docker installation path. Explicitly accept
`ID=rocky` with major version 9, without accepting arbitrary ID_LIKE derivatives.
Use the user's Rocky 9.5 release fields as a regression fixture. Verify the
existing Docker repository against Rocky's official guide, update documentation,
test and push. Do not bypass platform validation or change the user's host.
