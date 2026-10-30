/**
 * WpCalc (.calc) importer
 *
 * WpCalc files are Microsoft Access (Jet) databases with these tables:
 * - calculaties: project metadata (1 row)
 * - data: cost items (rectype 8=chapter, 4=subheader, 0=post, 5=textrow, 16=footer)
 * - staart: tail costs (UKK, AK, W&R, BTW)
 * - tarieven: labor rate groups (A, B, C, ...)
 * - uren: hour summaries
 * - uittrekstaten: quantity take-off details
 *
 * Hierarchy: groep → paragraaf → volgnr
 *   groep = chapter number (e.g. 0, 5, 12, 24)
 *   paragraaf = sub-section (0 = direct under chapter, >0 = under subheader rectype=4)
 *   volgnr = sort order within section
 *   tabs = indentation depth
 */
import MDBReader from 'mdb-reader';
import { Buffer } from 'buffer';
import { COST_ROW_TYPES, type CostItem, type CostSchedule, type CompanyInfo, type ResourceType, type StagartRow, type RowType } from './types';
import { makeStaartItem } from './staartDefaults';
import { makeCostItem, normalizeUnit, genId, genIfcGuid } from './importCore';

function num(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

interface WpCalcRow {
  recnr: number;
  docnr: number;
  groep: number;
  paragraaf: number;
  volgnr: number;
  tabs: number;
  rectype: number;
  omschrijving: string | null;
  eenheid: string | null;
  aantal: number | null;
  prijs: number | null;
  kosteneh: number | null;
  minuten: number | null;
  norm: number | null;
  verbruik: number | null;
  tariefgroep: string | null;
  tarief: number | null;
  onderaanneming: boolean;
  materieel: boolean;
  stelpost: boolean;
  vastbedrag: boolean;
  rekenstring: string | null;
  code: string | null;
  artikelnr: string | null;
  memotekst: string | null;
}

interface WpCalcStaart {
  recnr: number;
  code: string;
  volgnr: number;
  itemtype: number;
  itemstyle: number | null;
  omschrijving: string | null;
  percentage: number | null;
  bedrag: number | null;
  subtotaal: number | null;
  totaal: number | null;
  loon: number | null;
  materiaal: number | null;
  materieel: number | null;
  stelpost: number | null;
  onderaanneming: number | null;
}

interface WpCalcCalc {
  docnr: number;
  calculatietitel: string;
  offertenr: string;
  calculator: string;
  naam: string;
  woonplaats: string;
  adres: string;
  totaalexclbtw: number;
  totaalinclbtw: number;
  totaalmateriaal: number;
  totaalloon: number;
  totaalmaterieel: number;
  totaalonderaanneming: number;
  totaalstelposten: number;
  totaaluren: number;
}

export function importWpCalcFile(buffer: ArrayBuffer): {
  schedule: CostSchedule;
  items: CostItem[];
  companyInfo: CompanyInfo;
  sourceTotals: { exclusive: number | null; inclusive: number | null };
} {
  // mdb-reader's browser inflate path expects the Node-compatible global.
  (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
  const buf = Buffer.from(new Uint8Array(buffer));
  const reader = new MDBReader(buf as any);
  const tableNames = reader.getTableNames();
  if (!tableNames.includes('data') || !tableNames.includes('calculaties')) {
    throw new Error('This Access database is not a WPCalc calculation.');
  }
  const sourceCalculations = reader.getTable('calculaties').getData();
  if (sourceCalculations.length > 1) {
    throw new Error('Multi-document WPCalc files cannot be edited without selecting a calculation first. Export a single calculation from WPCalc.');
  }
  const sourceDoc = sourceCalculations.length ? num(sourceCalculations[0].docnr) : null;
  for (const name of ['data', 'tarieven', 'staart']) {
    if (!tableNames.includes(name)) continue;
    if (reader.getTable(name).getData().some(row => sourceDoc === null || (num(row.docnr) !== sourceDoc && !(name === 'tarieven' && num(row.docnr) === -1)))) {
      throw new Error('This WPCalc database contains records from another calculation. Export a single calculation before importing.');
    }
  }

  // ── Read calculaties (project metadata) ──
  let calc: WpCalcCalc | null = null;
  if (tableNames.includes('calculaties')) {
    const rows = reader.getTable('calculaties').getData();
    if (rows.length > 0) {
      const r = rows[0];
      calc = {
        docnr: num(r.docnr) || 0,
        calculatietitel: String(r.calculatietitel || ''),
        offertenr: String(r.offertenr || ''),
        calculator: String(r.calculator || ''),
        naam: String(r.naam || ''),
        woonplaats: String(r.woonplaats || ''),
        adres: String(r.adres || ''),
        totaalexclbtw: num(r.totaalexclbtw) || 0,
        totaalinclbtw: num(r.totaalinclbtw) || 0,
        totaalmateriaal: num(r.totaalmateriaal) || 0,
        totaalloon: num(r.totaalloon) || 0,
        totaalmaterieel: num(r.totaalmaterieel) || 0,
        totaalonderaanneming: num(r.totaalonderaanneming) || 0,
        totaalstelposten: num(r.totaalstelposten) || 0,
        totaaluren: num(r.totaaluren) || 0,
      };
    }
  }

  // ── Read tarieven (labor rates) ──
  const tarieven = new Map<string, number>();
  if (tableNames.includes('tarieven')) {
    const rows = reader.getTable('tarieven').getData().sort((a, b) => Number(num(a.docnr) !== -1) - Number(num(b.docnr) !== -1));
    for (const r of rows) {
      const groep = String(r.tariefgroep || 'A');
      const tarief = num(r.tarief);
      if (tarief !== null) tarieven.set(groep, tarief);
    }
  }

  // ── Read data (cost items) ──
  const dataRows: WpCalcRow[] = [];
  if (tableNames.includes('data')) {
    const rows = reader.getTable('data').getData();
    for (const r of rows) {
      dataRows.push({
        recnr: num(r.recnr) || 0,
        docnr: num(r.docnr) || 0,
        groep: num(r.groep) || 0,
        paragraaf: num(r.paragraaf) || 0,
        volgnr: num(r.volgnr) || 0,
        tabs: num(r.tabs) || 0,
        rectype: num(r.rectype) || 0,
        omschrijving: r.omschrijving ? String(r.omschrijving) : null,
        eenheid: r.eenheid ? String(r.eenheid) : null,
        prijs: num(r.prijs),
        aantal: num(r.aantal),
        kosteneh: num(r.kosteneh),
        minuten: num(r.minuten),
        norm: num(r.norm),
        verbruik: num(r.verbruik),
        tariefgroep: r.tariefgroep ? String(r.tariefgroep) : null,
        tarief: num(r.tarief),
        onderaanneming: !!r.onderaanneming,
        materieel: !!r.materieel,
        stelpost: !!r.stelpost,
        vastbedrag: !!r.vastbedrag,
        rekenstring: r.rekenstring ? String(r.rekenstring) : null,
        code: r.code ? String(r.code) : null,
        artikelnr: r.artikelnr ? String(r.artikelnr) : null,
        memotekst: r.memotekst == null ? null : String(r.memotekst),
      });
    }
  }

  // Sort by groep, paragraaf, volgnr, recnr
  dataRows.sort((a, b) =>
    a.groep - b.groep ||
    a.paragraaf - b.paragraaf ||
    a.volgnr - b.volgnr ||
    a.recnr - b.recnr
  );

  // ── Read staart (tail costs) ──
  const staartRows: WpCalcStaart[] = [];
  if (tableNames.includes('staart')) {
    const rows = reader.getTable('staart').getData();
    for (const r of rows) {
      staartRows.push({
        recnr: num(r.recnr) || 0,
        code: String(r.code ?? ''),
        volgnr: num(r.volgnr) || 0,
        itemtype: num(r.itemtype) || 0,
        itemstyle: num(r.itemstyle),
        omschrijving: r.omschrijving ? String(r.omschrijving) : null,
        percentage: num(r.percentage),
        bedrag: num(r.bedrag),
        subtotaal: num(r.subtotaal),
        totaal: num(r.totaal),
        loon: num(r.loon),
        materiaal: num(r.materiaal),
        materieel: num(r.materieel),
        stelpost: num(r.stelpost),
        onderaanneming: num(r.onderaanneming),
      });
    }
    staartRows.sort((a, b) => a.volgnr - b.volgnr);
  }

  // ── Build CostSchedule ──
  const schedule: CostSchedule = {
    id: genId(),
    name: calc?.calculatietitel || 'WpCalc Import',
    description: '',
    status: 'DRAFT',
    predefinedType: 'BUDGET',
    currency: 'EUR',
    projectName: calc?.calculatietitel || '',
    projectNumber: calc?.offertenr || '',
    client: calc?.naam || '',
    author: calc?.calculator || '',
    ifcGuid: genIfcGuid(),
    uitvoeringskosten: 0,
    algemeneKosten: 0,
    winstRisico: 0,
    tarieven: Object.fromEntries(tarieven),
  };

  // Extract UKK/AK/W&R percentages from staart
  for (const s of staartRows) {
    const omschr = (s.omschrijving || '').toLowerCase();
    if (s.percentage !== null) {
      if (omschr.includes('algemene kosten') || omschr.includes('algemene bedrijfskosten')) {
        schedule.algemeneKosten = Math.round(s.percentage * 10000) / 100;
      } else if (omschr.includes('winst') || omschr.includes('risico')) {
        schedule.winstRisico += Math.round((s.percentage || 0) * 10000) / 100;
      }
    }
  }

  // ── Build CostItems ──
  const items: CostItem[] = [];
  let sortOrder = 0;

  // Track chapter IDs for parenting
  const chapterIds = new Map<number, string>(); // groep → chapter id
  const subheaderIds = new Map<string, string>(); // "groep-paragraaf" → subheader id

  for (const row of dataRows) {
    // Skip footer rows (rectype 16)
    if (row.rectype === 16) continue;
    if (row.vastbedrag) throw new Error('WPCalc fixed-amount rows require an explicit calculation mapping before editing. The original file has not been changed.');

    // Skip empty text rows (no description, no amounts)
    const desc = row.omschrijving ?? '';
    const hasDescription = desc.trim().length > 0;
    if (!hasDescription && row.rectype !== 5) continue;

    const id = genId();
    const sourceFields = {
      wpcalcRowId: row.recnr,
      wpcalcOriginalCode: row.code,
      wpcalcArticleNumber: row.artikelnr,
      wpcalcOriginalUnit: row.eenheid,
      wpcalcNativeUnit: normalizeUnit(row.eenheid),
      unit: normalizeUnit(row.eenheid),
      code: row.code ?? '',
      notes: row.memotekst ?? '',
    };

    if (row.rectype === 8) {
      // ── Chapter (Hoofdstuk) ──
      chapterIds.set(row.groep, id);
      items.push(makeCostItem({
        id,
        ...sourceFields,
        parentId: null,
        sortOrder: sortOrder++,
        description: desc,
        rowType: 'chapter',
        depth: 0,
      }));
    } else if (row.rectype === 4) {
      // ── Subheader (Paragraaf/Bewakingspost) ──
      const parentId = chapterIds.get(row.groep) || null;
      const key = `${row.groep}-${row.paragraaf}`;
      subheaderIds.set(key, id);
      items.push(makeCostItem({
        id,
        ...sourceFields,
        parentId,
        sortOrder: sortOrder++,
        description: desc,
        rowType: 'begrotingspost',
        depth: 1,
      }));
    } else if (row.rectype === 5) {
      // ── Text row ──
      const parentId = findParentId(row, chapterIds, subheaderIds);
      if (hasDescription) {
        items.push(makeCostItem({
          id,
          ...sourceFields,
          parentId,
          sortOrder: sortOrder++,
          description: desc,
          rowType: 'tekstregel',
          depth: (row.tabs || 0) + 1,
        }));
      }
    } else if (row.rectype === 0) {
      // ── Regular post (regel) ──
      const parentId = findParentId(row, chapterIds, subheaderIds);
      const hasQuantity = row.aantal !== null && row.aantal !== 0;
      const hasPrice = (row.prijs !== null && row.prijs !== 0) || (row.kosteneh !== null && row.kosteneh !== 0);

      // Empty row without description and amounts → tekstregel separator
      if (!hasDescription && !hasQuantity && !hasPrice) continue;
      if (!hasQuantity && !hasPrice && hasDescription) {
        items.push(makeCostItem({
          id,
          ...sourceFields,
          parentId,
          sortOrder: sortOrder++,
          description: desc,
          rowType: 'tekstregel',
          depth: (row.tabs || 0) + 1,
        }));
        continue;
      }

      // Determine resource type from boolean flags
      let resourceType: ResourceType | null = null;
      if (row.onderaanneming) resourceType = 'onderaannemer';
      else if (row.materieel) resourceType = 'materieel';
      else if (row.stelpost) resourceType = 'overig';
      else resourceType = 'materiaal'; // default: materiaal (loon wordt apart berekend)

      // Tarief: resolve from row or tarieven table
      const tariefGroep = row.tariefgroep || 'A';
      // In WPCalc a zero row tariff inherits the group tariff, it is not free labor.
      const tariefPerUur = row.tarief || tarieven.get(tariefGroep) || 0;
      const explicitRate = row.tarief !== null && row.tarief !== 0 && row.tarief !== tarieven.get(tariefGroep);

      // WpCalc formule:
      //   loon = norm * tarief_per_uur (norm is in uren)
      //   kosteneh = prijs + loon
      //   bedrag = aantal * kosteneh
      const materialPrice = row.prijs;
      const normUren = row.norm; // productienorm in uren
      const laborPrice = (normUren || 0) * tariefPerUur;
      const uncalculated = row.kosteneh === null && ((materialPrice ?? 0) !== 0 || laborPrice !== 0);
      const nativeRateGroup = !explicitRate && (tariefGroep === 'A' || tariefGroep === 'B' || tariefGroep === 'C') ? tariefGroep : null;

      // kosteneh is the pre-calculated cost per unit from WpCalc
      const unitPrice = row.kosteneh || 0;
      const quantity = row.aantal;
      const total = (quantity || 0) * unitPrice;

      items.push(makeCostItem({
        id,
        ...sourceFields,
        parentId,
        sortOrder: sortOrder++,
        description: desc,
        quantity,
        materialPrice,
        laborPrice: uncalculated ? 0 : laborPrice,
        unitPrice,
        total,
        rowType: 'regel',
        depth: (row.tabs || 0) + 1,
        resourceType,
        normQuantity: normUren,
        normUnitPrice: uncalculated ? 0 : materialPrice,
        // An explicit row rate must not be overwritten by the schedule's group rate.
        tariefGroep: uncalculated ? null : nativeRateGroup,
        wpcalcRateGroup: tariefGroep,
        wpcalcCachedUnitPrice: row.kosteneh,
        ...(uncalculated ? {
          wpcalcUncalculatedPrice: true, wpcalcOriginalPrice: materialPrice,
          wpcalcOriginalQuantity: quantity, wpcalcOriginalLaborPrice: laborPrice,
          wpcalcOriginalTariefGroep: nativeRateGroup,
        } : {}),
        ...(row.rekenstring ? { wpcalcQuantityFormula: row.rekenstring, wpcalcOriginalQuantity: quantity } : {}),
      }));
    }
  }

  // Normalize depth from the actual parent chain. The raw `tabs` column is a
  // visual indent that doesn't always match the hierarchy (regels directly
  // under a chapter carried tabs=1 → depth 2). Wrong depths break subtree
  // detection (move/drag) and grid indentation.
  const itemById = new Map(items.map((i) => [i.id, i] as const));
  for (const it of items) {
    let d = 0;
    const guard = new Set<string>();
    let p = it.parentId ? itemById.get(it.parentId) : undefined;
    while (p && !guard.has(p.id)) {
      guard.add(p.id);
      d++;
      p = p.parentId ? itemById.get(p.parentId) : undefined;
    }
    it.depth = d;
  }

  // ── Store staart rows in schedule for bottom panel ──
  schedule.staartRows = staartRows.map(s => ({
    label: s.omschrijving || '',
    percentage: s.percentage !== null ? Math.round(s.percentage * 10000) / 100 : null,
    loon: s.loon,
    materiaal: s.materiaal,
    materieel: s.materieel,
    stelpost: s.stelpost,
    onderaanneming: s.onderaanneming,
    bedrag: s.bedrag,
    subtotaal: s.subtotaal,
    totaal: s.totaal,
    itemtype: s.itemtype,
  } satisfies StagartRow));

  // A missing source surcharge is zero, never a request for Dutch defaults.
  for (const source of staartRows) {
    const rowType = resolveWpCalcStaartType(source.code, source.omschrijving ?? '', source.itemtype);
    if (!rowType) {
      const summary = [4, 32, 64, 128].includes(source.itemtype);
      if (!summary && [source.percentage, source.subtotaal, source.bedrag, source.totaal,
        source.loon, source.materiaal, source.materieel, source.stelpost, source.onderaanneming].some(value => (value ?? 0) !== 0)) {
        throw new Error(`Unsupported WPCalc surcharge: ${source.omschrijving ?? source.itemtype}. Its calculation basis must be mapped before editing.`);
      }
      continue;
    }
    // Labels cannot establish an undocumented resource-selection mask.
    if (source.code !== `peercalc:${rowType}` && source.itemstyle !== (source.itemtype === 1 ? 79 : 32)) {
      throw new Error(`Unsupported WPCalc surcharge basis: ${source.omschrijving ?? source.itemtype}. Its resource selection must be verified before editing.`);
    }
    const item = makeStaartItem(rowType, source.omschrijving ?? '', source.percentage === null ? null : source.percentage * 100, sortOrder++);
    item.wpcalcStaartRowId = source.recnr;
    item.wpcalcStaartItemType = source.itemtype;
    item.code = source.code;
    if (rowType === 'staart_afronding') item.staartVastBedrag = source.subtotaal ?? source.bedrag ?? 0;
    if (rowType === 'staart_btw_laag') item.staartBtwBasis = source.bedrag ?? 0;
    items.push(item);
  }
  schedule.directCostsOnly = !items.some(item => item.rowType.startsWith('staart_'));

  // ── CompanyInfo ──
  const companyInfo: CompanyInfo = {
    name: '',
    postalAddress: calc?.adres || '',
    postalCity: calc?.woonplaats || '',
    visitAddress: '',
    visitCity: '',
    phone: '',
    fax: '',
    email: '',
    logoLeft: '',
    logoRight: '',
  };

  const sourceMetadata = sourceCalculations[0];
  return {
    schedule, items, companyInfo,
    sourceTotals: { exclusive: num(sourceMetadata?.totaalexclbtw), inclusive: num(sourceMetadata?.totaalinclbtw) },
  };
}

export function resolveWpCalcStaartType(code: string, description: string, itemtype: number): RowType | null {
  const marker = code.startsWith('peercalc:') ? code.slice('peercalc:'.length) : '';
  if (marker.startsWith('staart_') && COST_ROW_TYPES.includes(marker as RowType)) return marker as RowType;
  // WPCalc's numeric types are calculation semantics, not presentation labels.
  if ([0, 4, 32, 64, 128].includes(itemtype)) return null;
  if (itemtype === 1) return 'staart_ak';
  if (itemtype === 8) return 'staart_wr';
  if (itemtype === 256) return description.toLowerCase().includes('laag') ? 'staart_btw_laag' : 'staart_btw';
  return null;
}

function findParentId(
  row: WpCalcRow,
  chapterIds: Map<number, string>,
  subheaderIds: Map<string, string>,
): string | null {
  // If row has a paragraaf > 0, try to find its subheader parent
  if (row.paragraaf > 0 && row.paragraaf < 9999) {
    const key = `${row.groep}-${row.paragraaf}`;
    const subId = subheaderIds.get(key);
    if (subId) return subId;
  }
  // Otherwise, parent is the chapter
  return chapterIds.get(row.groep) || null;
}
