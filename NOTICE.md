# Licensing and Attribution

PeerCalc is free software under LGPL-3.0-only. See LICENSE and COPYING.

The calculation engine, staart defaults, WPCalc importer, and importer helpers in
`web/src/domain/` are adapted from Open Calc Studio by the
OpenAEC Foundation, commit `d4b5082ee6154d2889f26262f816674326aa0a79`:
https://github.com/OpenAEC-Foundation/open-calc-studio

The calculation engine retains upstream behavior except that summaries now sum
all same-type surcharge rows rather than overwriting earlier contributions,
mixed subcontract rows allocate their labor component to the labor column,
and text rows clear stale priced amounts when their type changes;
import paths and attribution headers were changed. The WPCalc importer uses an explicit browser Buffer and
retains original row ids for lossless-source export. It does not invent missing
surcharges, keeps explicit labor-rate overrides, validates source cached totals,
and rejects unmapped source calculations rather than silently changing quotes.
Synthetic native fixtures
and the empty WPCalc MDB template in `web/tests/domain/fixtures/`, plus the
calculator regression tests in `web/tests/domain/upstream-calculator.test.ts`,
are also from that commit. The native file schema and migration behavior
follow the upstream `.ifcCalc` / `.ocs` format, version 2.3.0. PeerCalc is an
independent project and does not claim endorsement by the OpenAEC Foundation.

Dependencies retain their respective licenses. No upstream branding, fonts, or
Blueprint CSS is included.

The Java converter's mappings derive from upstream
`src-tauri/src/wpcalc_export.rs`; its empty database resource is copied from
`src-tauri/resources/wpcalc-template.calc`. PeerCalc uses Jackcess to write
Access files on Linux instead of the upstream Windows OLEDB implementation.
Native validation, browser UI, versioned persistence, the converter service,
and Docker orchestration are PeerCalc additions. Vendored Sites build helpers
and optional UI scaffold retain their individual MIT notices.

`web/src/client/use-grid-virtualizer.ts` adapts the fixed-height portion of
upstream `src/components/grid/useGridVirtualizer.ts` under LGPL-3.0-only.
PeerCalc adds bounded table spacer rows and focused-row preservation.
