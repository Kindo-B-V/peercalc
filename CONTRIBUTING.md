# Contributing

Run the Docker stack and checks in [README.md](README.md) before submitting a
pull request. Keep calculation changes separate from presentation changes.

Exchange changes need a small synthetic fixture and a round-trip regression
test. Verify totals and hierarchy, not merely that an importer accepts its own
export. Never replace real MDB with JSON carrying a `.calc` suffix.

Preserve unknown native fields and unedited MDB tables/columns. Reject
unsupported calculations instead of silently dropping them. Adapted upstream
changes must retain LGPL notices and record their source in `NOTICE.md`.

Security changes need ownership and malformed-input regression tests. Never
include private credentials or customer documents in a contribution.
