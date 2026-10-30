# Verified WPCalc Mapping

The `.calc` container is a genuine Microsoft Access MDB, not renamed JSON. The empty MDB schema and initial mapping come from the LGPL Open Calc Studio upstream, pinned in the repository notice. The Java implementation uses Jackcess, not SQL string concatenation or a Windows Access driver.

## Current Mappings

| Native data | MDB table/columns | Evidence |
| --- | --- | --- |
| Project name/client/author/number | `calculaties.calculatietitel/naam/calculator/offertenr` | Java MDB readback tests |
| Current total, VAT, resource columns, hours | `calculaties.totaalexclbtw/totaalinclbtw/btw/totaal*/totaaluren` | Recomputed, not copied from stale source caches |
| Actual high/low VAT percentages | `calculaties.btwhoog/btwlaag` and `staart.percentage` | Java readback test with 19% VAT |
| Chapter/post/calculation/text | `data.rectype` 8/4/0/5 | Native-to-MDB-to-native integration |
| Chapter/post/row ordering | `data.groep/paragraaf/volgnr/tabs` | Flat WPCalc hierarchy, one post level currently |
| Quantity and material price | `data.aantal/prijs` | Edited-quantity round-trip |
| Labor norm and hourly rate | `data.norm/tarief/tariefgroep` | Explicit row overrides remain independent of group rates |
| Cost per unit | `data.kosteneh = normUnitPrice + laborPrice` | Native `regel.unitPrice` is a line total and must not be copied here |
| Resource classification | `data.onderaanneming/materieel/stelpost` | Standard category flags; labor split uses norm/rate |
| Resource surcharge / amount surcharge / VAT | `staart.itemtype` 1 / 8 / 256, percentages and calculated resource/amount columns | Real-source readback and synthetic regression |
| Tail total rows | `staart.itemtype` 32 direct, 4 cost price, 64 excluding VAT, 128 including VAT | Refreshed source caches, not mistaken for tax or rounding |
| Renamed surcharge type | `staart.code = peercalc:<rowType>` | Typed extension marker; MDB round-trip verifies renamed profit |
| Original row identity | Native `wpcalcRowId` and `wpcalcStaartRowId` to MDB `recnr` | Edited original-row identity test |

The source MDB is retained in `wpcalcSource.data`. Explicit imported row-ID lists identify managed deletions. Unrecognized tables/columns and skipped legacy rows remain in the original MDB. This is preservation, not a claim that every preserved construct is understood or recalculated. Linked MDB tables are rejected before they can read a server path.

Chapter footers (`data.rectype=16`) are emitted for new chapters. Existing footer row identities and opaque columns remain intact; chapter group changes remap them through the original chapter row ID. Unchanged source parent/sibling structure retains its original group/paragraph/sequence coordinates. Unsupported records prevent ambiguous structural edits rather than being discarded. Source-linked measurement rows cannot be deleted without a verified reference mapping.

Global labor rates (`tarieven.docnr=-1`) are updated in place, not duplicated as document-specific records. A zero row tariff remains the inheritance sentinel for grouped rates; explicit overrides remain explicit. Hour totals and known tail summary caches are recomputed while unmodeled tables remain unchanged. Nonzero purchasing/discount price components prevent unsupported final-price edits. A source priced row with a NULL cached cost remains explicitly uncalculated until the user activates it; exporting a dormant row preserves its original price and NULL cache.

## Source Index Compatibility

The supplied real-world source has a compound-index parent/last-child representation that Jackcess rejects on some index mutations, including an unmodified-row update. It is not appropriate to call the original file corrupt solely from this library interpretation. No source indexes are repaired, removed, or reconstructed.

The pinned Jackcess 5.0.4 compatibility patch skips index DELETE/ADD only when old and new encoded keys are byte-identical for the same row ID. Non-indexed price/quantity/norm edits therefore preserve the index bytes. Actual key changes retain the official library path and all its constraint checks; unsupported structural mutations return HTTP 422 `SOURCE_INDEX_UNSUPPORTED`, with the original file untouched. The generated class is compiled by the ordinary Maven lifecycle and included in the Docker artifact. See `NOTICE`, `scripts/PatchJackcess.java`, and `patches/IndexData-unchanged-keys.patch` for source checksum, scope, and license.

Private-source checks verify all 439 original data rows accept no-op and non-indexed price updates with the patch, original NULL cached pricing remains dormant, source global rates are not duplicated, and opaque tables including the 343 take-off records remain unchanged through financial edits. These tests do not publish private source data and are opt-in. They establish logical MDB preservation and readback, not Windows WPCalc certification.

## Unverified Semantics

The upstream exporter and older bundled empty MDB do not define every current proprietary encoding. Rich-schema source files retain their complete schema, existing table definitions, and unmodeled records. New native exports still use the upstream empty template; they must be opened and recalculated in the target application before claiming current-version certification. Deeper hierarchy, per-row VAT, arbitrary surcharge bases, target-total rounding, and formula/measurement controls need further verified fixtures. Do not guess control bits or overwrite opaque columns based on their names.

The vendor's [feature overview](https://wpcalc.nl/calculatieprogramma-functieoverzicht/) confirms that WPCalc itself supports per-row VAT and deeper hierarchies, but does not publish their MDB encoding. Therefore these are implementation gaps, not limitations of the underlying industry software. Explicit export errors protect native data until verified source fixtures and target-application readback are available.

Next interoperability evidence should include genuine WPCalc-created fixtures for each advanced construct, expected totals before and after changing one quantity, and opening the generated database in WPCalc. Passing the current native/MDB integration tests does not certify that application-level behavior.

Import only assigns foreign surcharge semantics from verified numeric types and
resource masks: type 1/mask 79 and types 8 or 256/mask 32. An unknown type is not
made into a percentage charge merely because its label says "winst" or "btw".
PeerCalc's explicit typed markers remain readable as PeerCalc metadata; they do
not independently establish target-application compatibility.

The vendor's [trial download](https://wpcalc.nl/calculatieprogramma-bouw-download-demo-pro/)
is sent after a contact form and CAPTCHA, rather than offered as an unrestricted
installer. No trial was requested or licensed application installed during this
delivery. An authorized installer or user-operated Windows readback is still
needed for the remaining application-level gate.

Fixed-rounding item type 2 was not established by the supplied source or an authoritative specification. Nonzero fixed rounding is therefore rejected; a zero default rounding row is omitted from MDB exports. Resource-selection masks 7 and 64 in fresh-template category-surcharge output are inferred extensions, not target-application verified mappings; the supplied original-file path preserves its verified mask 79. The typed PeerCalc code marker establishes our own reimport identity, not WPCalc's recalculation behavior. These distinctions remain interoperability gaps until target readback is available.
