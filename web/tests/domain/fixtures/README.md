# Upstream Compatibility Fixtures

These files are copied unchanged from OpenAEC Foundation Open Calc Studio,
commit `d4b5082ee6154d2889f26262f816674326aa0a79`, under LGPL-3.0-only.

- The three `.ifcCalc` files are fully synthetic fixtures from
  `test/fixtures/import-formats/`. Their direct costs are respectively
  EUR 29,413.50, EUR 68,613.50, and EUR 79,623.50. The upstream manifest rounds
  those values to whole euros; they are not VAT-inclusive project totals.
- `wpcalc-template.calc` is the real empty Jet MDB template from
  `src-tauri/resources/wpcalc-template.calc`.

Source: https://github.com/OpenAEC-Foundation/open-calc-studio

The upstream calculator regression tests in the parent folder retain upstream
behavior. PeerCalc-specific tests add lossless opaque-field preservation,
trust-boundary validation, and native/MDB import checks.
