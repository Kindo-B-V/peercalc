# T20261030-001: Product Requirements and Verification

## Objective

An open-source web construction-estimating product using the calculation and
file formats of Open Calc Studio, with authentication, durable storage,
and version history. The user explicitly confirmed native AND legacy `.calc`
round-trip support, then selected an entirely local Docker deployment.

## Work Ownership

1. format_core: native schema, calculation engine, legacy import, fixtures and domain tests.
2. cloud_backend: authenticated project API, D1/R2 storage, immutable revisions, Java converter and tests.
3. workspace_ui: estimate editor, project navigation, metadata, charges, import/export, history and report.
4. root: integration, hosting, licensing, repository, validation and execution tracking.

## Verification Gates

- Native import/export retains unknown fields and upstream fixtures.
- Legacy import/export uses actual MDB, preserves source data, and reads back with an independent reader.
- Calculations cover nested costs, labor norms, rates, cumulative charges and VAT.
- API rejects anonymous access, another user's records, malformed documents and stale saves.
- Versions survive process/session boundaries and restore creates a new head.
- Browser workflows cover editing, authenticated save/load, import/export, history and report.
- Desktop and mobile layouts are inspected in a browser.
- Open-source source, license, attribution, setup and deployment instructions are present.
- Local Docker startup succeeds with real authentication and persistent D1/R2-compatible storage.

## Risks and Boundaries

The cloud Worker cannot run the Windows OLEDB exporter. Legacy export therefore
requires a separate Java container using Jackcess. No production estimate data
may be silently discarded. Unsupported legacy structures must produce an error
instead of a partial file. Files are never asserted to have industry-wide
standard status merely because an upstream implementation supports them.

The user later supplied one private source database; it and generated customer
exports stay outside Git. Roll back a deployment using an earlier source version,
preserving append-only database migrations and project snapshots. No shared external
workspace or Notion project is modified without an identified matching record.
