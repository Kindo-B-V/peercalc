# Plan

- TicketID: T20261030-001
- Title: PeerCalc cloud calculation workspace
- Stage: plan
- Description: Open-source browser estimating with native and legacy exchange, local Docker authentication, durable storage and versioning
- Status: Testing
- Priority: Medium
- Project URL: https://github.com/Kindo-B-V/peercalc
- Notion Issue URL: -
- Agent Question: -
- User Answer: -

## 2026-10-30T12:02:48

Autonomous plan: native format and calculator, secure cloud persistence and revisions, web editor, tests, open-source repository and cloud deployment; three parallel owners

## Objective

Deliver the requested open-source browser calculation product while retaining
native and genuine legacy exchange formats, authentication, storage and history.
Latest user direction: run all components locally in Docker, not in the cloud.

## Scope In

Native JSON round-trip, calculation model reuse, genuine MDB import/export,
estimate editing, metadata, variants, charges, report/PDF, real authentication,
owner isolation, durable document snapshots, revision conflict handling, local
Docker orchestration, tests, source licensing and public source repository.

## Scope Out

No cloud publication after the local-only clarification. No real customer file
or private credentials in the public repository. Production internet hosting
requires separate identity, HTTPS and operational hardening.

## Steps

1. Inspect upstream schema, calculations and license; assign independent owners.
2. Reuse the pure calculation core, validate native data and preserve opaque fields.
3. Implement authenticated metadata/object storage and immutable revisions.
4. Build the estimating UI and converter as parallel, bounded workstreams.
5. Integrate Docker OIDC, persistence and genuine MDB conversion.
6. Verify unit/service/browser tests and private sample-derived compatibility.
7. Publish only source, license and synthetic fixtures; retain actual data locally.

## Risks and Mitigations

Legacy encodings need real-file evidence. Do not guess flags from column names
or silently simplify calculations. Source-preserving MDB edits retain unrelated
tables and columns. Unsupported constructs fail rather than produce a partial
file. Native variants are calculated through an active-view projection while
all branches stay in saved documents. Every API operation checks ownership and
revision preconditions; gateway identity headers replace browser-supplied ones.

## Validation Strategy

Calculation and native fixture regressions; genuine MDB readback with independent
libraries; actual SQLite transactions and concurrent writes; real local OIDC
with two independent users; desktop/mobile editor flows; PDF and import/export;
private source comparisons against table-derived amounts. Never equate a green
self-round-trip alone with complete target-application interoperability.

## Rollback Strategy

Keep versioned native documents and append-only database migrations. Rebuild an
earlier source commit without deleting Docker volumes. Original private files
are never overwritten. `docker compose down` preserves state; `down -v` does not.

## Definition Of Done

All requirements in REQUIREMENTS.md must have direct current-state evidence.
The current delivery remains in progress while legacy compatibility gaps are
being resolved and target-application interoperability is not yet certified.
