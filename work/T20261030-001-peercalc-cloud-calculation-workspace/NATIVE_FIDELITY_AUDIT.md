# Native Format Fidelity Audit

Date: 2026-10-30

## Scope

Compared PeerCalc's `.ocs` / `.ifcCalc` import, calculation projection and export
with Open Calc Studio commit `d4b5082ee6154d2889f26262f816674326aa0a79`.
The upstream schema, native file service, migration ladder and calculator were
inspected. This audit uses only public fixtures and synthetic examples, not
customer files or owner screenshots.

## Independent Oracle

The actual pinned upstream `fileService.ts` and calculator were bundled with
esbuild alongside PeerCalc's domain module. Only `i18next` was replaced with
its uninitialized state; this selects the upstream English error-message
fallback and does not replace parsing, migration, serialization or arithmetic.

From the repository's `web/` directory:

```sh
node outputs/native-oracle.mjs
node /tmp/peercalc-native-oracle-check.mjs
```

Temporary supporting files:

- `/tmp/peercalc-native-oracle-entry.ts`
- `/tmp/peercalc-native-oracle.mjs`
- `/tmp/peercalc-native-oracle-check.mjs`
- `/tmp/peercalc-native-oracle-report.json`

These local oracle files are diagnostic artifacts, not runtime dependencies.

All three genuine native fixtures were loaded and calculated by PeerCalc,
exported through PeerCalc's serializer, read by the actual upstream native
reader, saved through the upstream serializer, and read again. For each fixture,
items, schedule, company information, spreadsheets and snapshots survived the
upstream save/read cycle unchanged. The fixtures were:

- `01-ifccalc-klein.ifcCalc`
- `02-ifccalc-staart.ifcCalc`
- `03-ifccalc-kengetallen.ifcCalc`

## Proven Defects Fixed

1. **Absent optional labor-rate tables changed imported prices.** Importing a
   document without `schedule.tarieven` previously injected new-project A/B/C
   defaults. A synthetic row with quantity 2, norm 1 and stored labor price 70
   changed from the upstream total 140 to 128. The importer now preserves an
   omitted table, so both readers/calculators produce 140. New projects still
   receive their normal default rate table.
2. **Version-one migration did not apply upstream defaults.** Legacy chapters
   without an explicit `verrekenbaar` now receive `V`; explicit chapter values
   remain unchanged, and legacy normal rows become `begrotingspost` with the
   upstream settlement-class behavior. Nullable legacy text, display-price and
   collapse fields receive the same nullish defaults as the upstream migration.
   Opaque legacy extension fields remain retained.

Implementation: `web/src/domain/index.ts`, native parsing around lines 188-205.
Regressions: `web/tests/domain/native.test.ts`, the migration and missing-rate
tests around lines 43-82. Six targeted cases failed before the patch and passed
after it, covering versionless, 1.x, 2.0 and 2.3 documents.

## Deliberate Arithmetic Difference

PeerCalc retains its correction that splits labor from the subcontract portion
of a mixed subcontract resource. The pinned upstream calculator attributes
that entire resource total to subcontracting. In a synthetic quantity-2 row
with material price 10, labor price 5 and a 10% subcontract surcharge, upstream
produces 33 and PeerCalc produces 32. This is a documented pricing correction,
not a file-format change; no attempt was made to restore the upstream behavior.

## Preservation and Limits

The native serializer preserves top-level and nested opaque JSON fields, while
the calculator replaces derived row values and hierarchy ordering as expected.
Existing regressions cover PDFs, quantity origins, spreadsheets, offer content,
snapshots, resource metadata, timestamps and inactive variant rows. This does
not imply that every upstream editor or source-link engine exists in PeerCalc.

Explicit document-size, row-count, hierarchy-depth and major-version checks
remain fail-closed. They are application limits, not silent truncation.

Validation after the fixes:

```sh
npx vitest run --config vitest.config.ts
npx tsc --noEmit
```

Result in this audit: 67 unit tests passed, 4 opt-in live/private cases skipped;
TypeScript validation passed. Parent orchestration separately runs the enabled
live/private gates and the final Docker/browser acceptance suite.
