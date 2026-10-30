import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock('mdb-reader', () => ({ default: class {
  getTableNames() { return Object.keys(source.tables); }
  getTable(name: string) { return { getData: () => source.tables[name] }; }
} }));
import { importWpCalc } from '../../src/domain/wpcalc';
import { calculateProject, getKostprijs, getGrandTotal } from '../../src/domain';

beforeEach(() => {
  source.tables = {
    calculaties: [{ docnr: 1, calculatietitel: 'Fidelity' }],
    data: [{ docnr: 1, recnr: 1, rectype: 0, omschrijving: 'Post', aantal: 2, prijs: 10, kosteneh: 10 }],
    tarieven: [], staart: [],
  };
});

describe('source calculation integrity', () => {
  it('preserves source whitespace and keeps codes, article references and raw units separate', () => {
    source.tables.data[0] = { ...source.tables.data[0], groep: 7, omschrijving: '  Source line\t', code: null, artikelnr: 'SYNTHETIC-ARTICLE', eenheid: 'M^2', memotekst: '  Synthetic note\n' };
    source.tables.data.unshift({ docnr: 1, recnr: 2, rectype: 8, groep: 7, omschrijving: '  Source chapter\n', code: null });
    const project = importWpCalc(new ArrayBuffer(0));
    const chapter = project.items.find(row => row.rowType === 'chapter')!;
    const row = project.items.find(row => row.rowType === 'regel')!;
    expect(chapter.code).toBe('');
    expect(chapter.description).toBe('  Source chapter\n');
    expect(row.description).toBe('  Source line\t');
    expect(row.code).toBe('');
    expect(row.wpcalcArticleNumber).toBe('SYNTHETIC-ARTICLE');
    expect(row.wpcalcOriginalUnit).toBe('M^2');
    expect(row.wpcalcNativeUnit).toBe('m²');
    expect(row.unit).toBe('m²');
    expect(row.notes).toBe('  Synthetic note\n');
  });

  it('inherits global group tariffs when a WPCalc row uses the zero tariff sentinel', () => {
    source.tables.tarieven = [{ docnr: -1, tariefgroep: 'A', tarief: 68 }];
    Object.assign(source.tables.data[0], { tariefgroep: 'A', tarief: 0, norm: 0.25, kosteneh: 27 });
    const project = importWpCalc(new ArrayBuffer(0));
    expect(project.items[0].laborPrice).toBe(17);
    expect(project.items[0].tariefGroep).toBe('A');
    expect(getKostprijs(project.items)).toBe(54);
  });

  it('lets calculation-specific rates override global rate defaults', () => {
    source.tables.tarieven = [
      { docnr: 1, tariefgroep: 'A', tarief: 72 },
      { docnr: -1, tariefgroep: 'A', tarief: 68 },
    ];
    Object.assign(source.tables.data[0], { tariefgroep: 'A', tarief: 0, norm: 0.25, kosteneh: 28 });
    const project = importWpCalc(new ArrayBuffer(0));
    expect(project.schedule.tarieven?.A).toBe(72);
    expect(getKostprijs(project.items)).toBe(56);
  });

  it('preserves uncached source prices as an explicit excluded state until activation', () => {
    source.tables.data.push({ docnr: 1, recnr: 2, rectype: 0, omschrijving: 'Uncalculated source row', aantal: 3, prijs: 17, kosteneh: null });
    source.tables.calculaties[0].totaalexclbtw = 20;
    source.tables.calculaties[0].totaalinclbtw = 20;
    const project = importWpCalc(new ArrayBuffer(0));
    const row = project.items.find(item => item.wpcalcRowId === 2)!;
    expect(getKostprijs(project.items)).toBe(20);
    expect(row.wpcalcUncalculatedPrice).toBe(true);
    expect(row.wpcalcOriginalPrice).toBe(17);
    expect(row.wpcalcOriginalQuantity).toBe(3);
    expect(row.wpcalcCachedUnitPrice).toBeNull();
    expect(row.normUnitPrice).toBe(0);
    row.quantity = 4;
    expect(() => calculateProject(project)).toThrow('explicitly');
    row.quantity = 3;
    row.normUnitPrice = 17;
    expect(() => calculateProject(project)).toThrow('explicitly');
    row.wpcalcUncalculatedPrice = false;
    expect(getKostprijs(calculateProject(project).items)).toBe(71);
  });

  it('uses real WPCalc surcharge codes over all cost classes and ignores cached summaries', () => {
    source.tables.tarieven = [{ docnr: -1, tariefgroep: 'A', tarief: 10 }];
    source.tables.data = [
      { recnr: 1, docnr: 1, rectype: 0, omschrijving: 'Material', aantal: 1, prijs: 10, kosteneh: 10 },
      { recnr: 2, docnr: 1, rectype: 0, omschrijving: 'Labor', aantal: 1, prijs: 0, norm: 2, tarief: 0, tariefgroep: 'A', kosteneh: 20 },
      { recnr: 3, docnr: 1, rectype: 0, omschrijving: 'Equipment', aantal: 1, prijs: 30, materieel: true, kosteneh: 30 },
      { recnr: 4, docnr: 1, rectype: 0, omschrijving: 'Allowance', aantal: 1, prijs: 15, stelpost: true, kosteneh: 15 },
      { recnr: 5, docnr: 1, rectype: 0, omschrijving: 'Subcontract', aantal: 1, prijs: 25, onderaanneming: true, kosteneh: 25 },
    ];
    source.tables.staart = [
      { recnr: 1, docnr: 1, volgnr: 1, itemtype: 32, omschrijving: 'Direct summary', totaal: 100 },
      { recnr: 2, docnr: 1, volgnr: 2, itemtype: 1, itemstyle: 79, omschrijving: 'Synthetic overhead', percentage: 0.07, subtotaal: 7 },
      { recnr: 3, docnr: 1, volgnr: 3, itemtype: 4, omschrijving: 'Cost summary', totaal: 107 },
      { recnr: 4, docnr: 1, volgnr: 4, itemtype: 8, itemstyle: 32, omschrijving: 'Synthetic bid allowance', percentage: 0.03, subtotaal: 3.21 },
      { recnr: 5, docnr: 1, volgnr: 5, itemtype: 64, omschrijving: 'Exclusive summary', totaal: 110.21 },
      { recnr: 6, docnr: 1, volgnr: 6, itemtype: 256, itemstyle: 32, omschrijving: 'Synthetic VAT', percentage: 0.2, bedrag: 110.21, subtotaal: 22.04 },
      { recnr: 7, docnr: 1, volgnr: 7, itemtype: 128, omschrijving: 'Inclusive summary', totaal: 132.25 },
    ];
    Object.assign(source.tables.calculaties[0], { totaalexclbtw: 110.21, totaalinclbtw: 132.25 });
    const project = importWpCalc(new ArrayBuffer(0));
    expect(getKostprijs(project.items)).toBe(100);
    expect(getGrandTotal(project.items)).toBeCloseTo(132.25, 2);
    expect(project.items.filter(row => row.rowType.startsWith('staart_')).map(row => row.rowType)).toEqual(['staart_ak', 'staart_wr', 'staart_btw']);
  });

  it('preserves explicit per-row labor rates that differ from the schedule rate', () => {
    source.tables.tarieven = [{ docnr: 1, tariefgroep: 'A', tarief: 60 }];
    Object.assign(source.tables.data[0], { tariefgroep: 'A', tarief: 75, norm: 0.5, kosteneh: 47.5 });
    const project = importWpCalc(new ArrayBuffer(0));
    expect(project.items[0].laborPrice).toBe(37.5);
    expect(project.items[0].tariefGroep).toBeNull();
    expect(project.items[0].wpcalcRateGroup).toBe('A');
    expect(getKostprijs(project.items)).toBe(95);
  });

  it('rejects discrepancies with source cached prices instead of silently changing a quote', () => {
    source.tables.data[0].kosteneh = 999;
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('recalculates differently');
  });

  it('rejects discrepancies with source saved project totals', () => {
    source.tables.calculaties[0].totaalexclbtw = 99;
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('total differs');
  });

  it('preserves quantity formulas but refuses edits that leave their result stale', () => {
    source.tables.data[0].rekenstring = '1 + 1';
    const project = importWpCalc(new ArrayBuffer(0));
    expect(project.items[0].wpcalcQuantityFormula).toBe('1 + 1');
    project.items[0].normUnitPrice = 12;
    expect(getKostprijs(calculateProject(project).items)).toBe(24);
    project.items[0].quantity = 3;
    expect(() => calculateProject(project)).toThrow('quantity formula');
  });

  it('rejects unsupported fixed-price semantics', () => {
    source.tables.data[0].vastbedrag = true;
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('fixed-amount');
  });

  it('rejects unknown fixed surcharges but does not mistake source summary rows for fees', () => {
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 16384, omschrijving: 'Unknown fee', subtotaal: 50 }];
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('Unsupported WPCalc surcharge');
    source.tables.staart[0].itemtype = 32;
    expect(getKostprijs(importWpCalc(new ArrayBuffer(0)).items)).toBe(20);
  });

  it.each(['Winst & Risico', 'Btw hoog', 'Afronding', 'Algemene kosten'])('does not guess unknown numeric surcharge semantics from the label %s', omschrijving => {
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 16384, omschrijving, percentage: 0.1 }];
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('Unsupported WPCalc surcharge');
  });

  it.each([null, 7, 64, 999])('does not apply all-resource costs to unverified mask %s', itemstyle => {
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 1, itemstyle, omschrijving: 'Algemene kosten', percentage: 0.1 }];
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('Unsupported WPCalc surcharge basis');
  });

  it('does not treat a fixed adjustment or a nonempty unknown type as a presentation-only row', () => {
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 2, omschrijving: 'Winst & Risico', percentage: 0.1 }];
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('Unsupported WPCalc surcharge');
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 0, omschrijving: '', loon: 5 }];
    expect(() => importWpCalc(new ArrayBuffer(0))).toThrow('Unsupported WPCalc surcharge');
  });

  it('retains explicit PeerCalc bridge semantics rather than inferring them from labels', () => {
    source.tables.staart = [{ docnr: 1, recnr: 1, itemtype: 1, itemstyle: 64, code: 'peercalc:staart_ak_oa', omschrijving: 'Renamed surcharge', percentage: 0.1 }];
    expect(importWpCalc(new ArrayBuffer(0)).items.at(-1)?.rowType).toBe('staart_ak_oa');
  });
});
