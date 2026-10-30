# Acceptance Evidence

## Verified In This Delivery

- Local Docker web application with real Keycloak/OAuth2 Proxy authentication.
- Per-user D1-compatible metadata and R2-compatible document storage in persistent volumes.
- Immutable versions, optimistic save conflicts, and restore as a new revision.
- Editable estimates, labor norms/rates, resource totals, cascading charges, VAT, variants and printable reports.
- Native upstream JSON exchange preserving opaque fields and all inactive variants.
- Genuine Access MDB import/export through a reproducible, licensed Jackcess converter.
- Private real-file tests compare original calculated costs, resource columns, VAT and hours.
- No-op MDB export preserves every original data field and non-calculated tail field; financial edits preserve takeoffs and opaque tables.
- The source's uncalculated priced row stays dormant until explicit activation.
- The index compatibility patch skips only byte-identical key updates; changed-key constraints and foreign keys remain tested.
- Browser tests cover real sign-in, a second owner, header spoofing, save/revise/restore, native/MDB exchange, reports, mobile and 20,000-row editing.
- Private fixtures, generated customer exports, runtime state and credentials are ignored by Git.

Public unit tests need no private file. Opt-in real-file and live converter tests
derive expectations from the input database, not hardcoded customer values.
Private browser artifacts are deliberately excluded from the public repository.

## Final Local Checks

- 71 domain/live-converter tests and 6 storage/API tests passed.
- 21 Java converter/index-constraint tests passed through Maven and Docker.
- 9 browser tests passed, including the opt-in private-file workflow and native
  files with omitted optional labor-rate tables.
- The private browser round-trip compared 13 tables and 46,054 fields, with no
  unexpected differences; only 27 documented derived-cache/timestamp changes.
- TypeScript, local credential setup self-test, Docker build/startup, and Compose
  validation passed. Production dependency audit reports zero vulnerabilities.
- Desktop/mobile views and 20,000-row navigation/editing were checked. The public
  README screenshot uses a separate account and synthetic demonstration data.

The user's existing private estimate was refreshed only after matching its
original bytes, name and revision, using compare-and-swap from revision 1 to 2.
The original saved revision remains available. No source database was modified.

## Follow-Up Fidelity Audit

The previous goal turn made progress: the product was committed, published, and
passed its first remote CI run. The follow-up audit found and corrected two
native migration defects: omitted labor-rate tables must not inherit new-project
defaults, and version-one chapters use the upstream nullish settlement/text
defaults. Regression cases failed before the fixes and now pass.

The actual pinned upstream reader/writer accepted PeerCalc exports of all three
public native fixtures. Items, schedule, company information, spreadsheets and
snapshots survived upstream save/read unchanged. A headless oracle bundled the
unmodified upstream file service and calculator; only the uninitialized UI
translation dependency was stubbed. Mixed subcontract/labor resource allocation
intentionally differs from an upstream pricing bug, as disclosed in NOTICE.md;
same file format does not require duplicating that bug.

Full recreation of all six Docker services retained the owner identity and
authenticated session, both existing projects and all three stored revisions.
Complete document hashes and revision metadata matched before and after, and
the browser remained authenticated on reload. No volume was removed.

Unknown foreign surcharge types/masks no longer acquire guessed semantics from
their descriptions. The supplied source still passes the complete private
round-trip. Advanced mappings remain open, not declared supported by rejection.
Official vendor trial access requires contact details and CAPTCHA; no request
was submitted. The user was asked to recalculate the private exported file in
the original application. Until that evidence is available, the full goal stays
active rather than claiming certified legacy interoperability.

## Latest User Direction

The user explicitly requested that all services run locally in Docker. Cloud
publication is therefore deferred, not silently substituted with a local mock.
The reserved Sites project remains unpublished. No external Notion project was
modified; tracking is local and links to the source repository.

## Remaining Goal Work

The complete original product goal is not declared achieved by this alpha.
Opening and recalculating generated files in Windows WPCalc/BasCalc has not been
verified. Fresh-template category masks are documented as inferred, not certified.
Advanced legacy encodings, measurement/formula edits, deeper hierarchy, and
structural updates against unsupported source indexes require additional proof
and implementation. These operations currently fail explicitly rather than
silently changing a quote. See `converter/FORMAT.md`.

Public internet operation also needs the HTTPS, identity, backup/retention and
operational gates in `SECURITY.md`; the local Docker stack must not simply be
bound to a public interface. These limits remain visible instead of redefining
the requested end state around a smaller passing implementation.
