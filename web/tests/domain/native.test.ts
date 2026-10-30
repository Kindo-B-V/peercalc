import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateProject, createItem, createProject, createSampleProject, getGrandTotal,
  getKostprijs, getLaborHours, getCalculationItems, computeKostprijsBreakdown, getStaartBreakdown, parseProject, stringifyProject, validateProject,
} from '../../src/domain';
import { importWpCalc } from '../../src/domain/wpcalc';
import { resolveWpCalcStaartType } from '../../src/domain/wpcalcImporter';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('native Open Calc Studio compatibility', () => {
  it.each([
    ['01-ifccalc-klein.ifcCalc', 29414],
    ['02-ifccalc-staart.ifcCalc', 68614],
    ['03-ifccalc-kengetallen.ifcCalc', 79624],
  ])('recalculates the genuine upstream fixture %s', (name, total) => {
    const project = calculateProject(parseProject(fixture(name)));
    // Upstream manifest rounds direct chapter costs to whole euros.
    expect(getKostprijs(project.items)).toBeCloseTo(total - 0.5, 2);
    expect(getGrandTotal(project.items)).toBeGreaterThan(total);
    expect(parseProject(stringifyProject(project))).toEqual(project);
  });

  it('retains opaque fields, PDFs, quantity origins, spreadsheets, snapshots and original timestamps', () => {
    const source = createSampleProject();
    source.createdAt = '2024-01-02T03:04:05Z';
    source.schedule.pdfWorkspace = { documents: [{ id: 'drawing', data: 'data:application/pdf;base64,JVBERg==' }], measurements: [{ area: 42 }] };
    source.spreadsheets = { sheets: [{ id: 'sheet', cells: { A1: { value: '=2*3' } } }], activeSheetId: 'sheet' };
    source.items[0].quantityOrigin = { source: 'ifc', fragmentId: 'some-object', custom: { nested: [1, 2, 3] } };
    source.snapshots = [{ id: 'snapshot', schedule: source.schedule, items: [{ custom: true }] }];
    source.offerte = { secties: [{ items: [{ afbeeldingen: ['image'], subItems: ['row'] }] }] };
    source.futureExtension = { version: 4, data: ['keep', 'everything'] };
    const roundtrip = parseProject(stringifyProject(source));
    expect(roundtrip).toEqual(source);
    const recalculated = calculateProject(roundtrip);
    expect(recalculated.futureExtension).toEqual(source.futureExtension);
    expect(recalculated.schedule.pdfWorkspace).toEqual(source.schedule.pdfWorkspace);
    expect(recalculated.items[0].quantityOrigin).toEqual(source.items[0].quantityOrigin);
    expect(recalculated.createdAt).toBe(source.createdAt);
  });

  it('migrates legacy row types and spreadsheets without dropping custom fields', () => {
    const source = createProject();
    const legacy = { ...source, version: '1.0.0', items: [{ id: 'old', isChapter: true, description: 'Legacy', custom: 123 }], subSheets: [{ id: 's1' }] };
    delete (legacy as Record<string, unknown>).spreadsheets;
    const parsed = parseProject(JSON.stringify(legacy));
    expect(parsed.items[0].rowType).toBe('chapter');
    expect(parsed.items[0].verrekenbaar).toBe('V');
    expect(parsed.items[0].custom).toBe(123);
    expect(parsed.spreadsheets?.activeSheetId).toBe('s1');
    expect(parsed.version).toBe('2.3.0');
  });

  it.each([undefined, '1.0.0', '2.0.0', '2.3.0'])('does not retroactively apply default labor rates to native version %s', version => {
    const source = createProject();
    source.schedule.directCostsOnly = true;
    delete source.schedule.tarieven;
    source.items = [createItem({ rowType: 'regel', description: 'Historical labor rate', quantity: 2,
      resourceType: 'arbeid', normQuantity: 1, tariefGroep: 'A', laborPrice: 70, normUnitPrice: 0 })];
    const parsed = parseProject(JSON.stringify({ ...source, version }));
    expect(Object.hasOwn(parsed.schedule, 'tarieven')).toBe(false);
    const calculated = calculateProject(parsed);
    expect(calculated.items[0].laborPrice).toBe(70);
    expect(getKostprijs(calculated.items)).toBe(140);
    expect(Object.hasOwn(parseProject(stringifyProject(calculated)).schedule, 'tarieven')).toBe(false);
  });

  it('uses the upstream nullish defaults for version-one chapters and keeps explicit settlement classes', () => {
    const source = createProject();
    const legacy = { ...source, version: '1.0.0', items: [
      { id: 'chapter-default', parentId: null, rowType: 'normal', isChapter: true, code: null, description: null,
        unit: null, unitPrice: null, total: null, isCollapsed: null, depth: null, notes: null, ifcGuid: null, nr: null, custom: 'retained' },
      { id: 'chapter-explicit', parentId: null, rowType: 'normal', isChapter: true, verrekenbaar: 'N' },
      { id: 'post', parentId: 'chapter-default', rowType: 'normal', verrekenbaar: 'V' },
    ] };
    const parsed = parseProject(JSON.stringify(legacy));
    expect(parsed.items[0]).toMatchObject({ rowType: 'chapter', code: '', description: '', unit: 'st', unitPrice: 0,
      total: 0, isCollapsed: false, depth: 0, notes: '', ifcGuid: '', nr: '', verrekenbaar: 'V', custom: 'retained' });
    expect(parsed.items[1].verrekenbaar).toBe('N');
    expect(parsed.items[2]).toMatchObject({ rowType: 'begrotingspost', verrekenbaar: null });
  });

  it('honors direct-cost-only files without introducing surcharges', () => {
    const source = createProject();
    source.schedule.directCostsOnly = true;
    source.items = [];
    expect(parseProject(stringifyProject(source)).items).toEqual([]);
  });

  it('supports additive newer minor versions while rejecting breaking majors', () => {
    const source = createProject();
    source.version = '2.99.0';
    expect(parseProject(stringifyProject(source)).version).toBe('2.99.0');
    source.version = '3.0.0';
    expect(() => parseProject(JSON.stringify(source))).toThrow(/Unsupported/);
  });
});

describe('calculation integrity', () => {
  it.each(['tekstregel', 'witregel'] as const)('clears cached priced amounts when a row becomes %s', rowType => {
    const source = createProject();
    source.items = [createItem({ rowType: 'chapter', id: 'chapter' }),
      createItem({ rowType: 'regel', parentId: 'chapter', quantity: 2, normUnitPrice: 40 })];
    const priced = calculateProject(source);
    expect(getKostprijs(priced.items)).toBe(80);
    priced.items[1].rowType = rowType;
    const converted = calculateProject(priced);
    expect(getKostprijs(converted.items)).toBe(0);
    expect(converted.items[1].unitPrice).toBe(0);
    expect(converted.items[1].total).toBe(0);
  });

  it('splits mixed subcontract rows into labor and subcontract resource columns', () => {
    const source = createProject();
    source.items = [
      createItem({ rowType: 'regel', resourceType: 'onderaannemer', quantity: 2, normUnitPrice: 40, laborPrice: 15 }),
      createItem({ rowType: 'regel', resourceType: 'onderaannemer', quantity: 1, normUnitPrice: 60 }),
      createItem({ rowType: 'staart_ak_oa', staartPercentage: 10 }),
    ];
    const result = calculateProject(source);
    expect(computeKostprijsBreakdown(result.items).loon).toBe(30);
    expect(computeKostprijsBreakdown(result.items).onderaanneming).toBe(140);
    expect(result.items.find(row => row.rowType === 'staart_ak_oa')?.total).toBe(14);
  });

  it('scopes active variants to ancestors while retaining every inactive row in the native document', () => {
    const source = createProject();
    source.schedule.branchesEnabled = true;
    source.schedule.branches = [
      { id: 'main', name: 'Basis', parentId: null },
      { id: 'a', name: 'Variant A', parentId: 'main' },
      { id: 'a1', name: 'Variant A1', parentId: 'a' },
      { id: 'b', name: 'Variant B', parentId: 'main' },
    ];
    source.schedule.activeBranchId = 'a1';
    source.items = [
      createItem({ rowType: 'chapter', id: 'root' }),
      createItem({ rowType: 'regel', parentId: 'root', quantity: 1, normUnitPrice: 100 }),
      createItem({ rowType: 'regel', parentId: 'root', quantity: 1, normUnitPrice: 200, branchId: 'a' }),
      createItem({ rowType: 'regel', parentId: 'root', quantity: 1, normUnitPrice: 50, branchId: 'a1' }),
      createItem({ rowType: 'regel', parentId: 'root', quantity: 1, normUnitPrice: 1000, branchId: 'b' }),
      createItem({ rowType: 'chapter', id: 'b-parent', branchId: 'b' }),
      createItem({ rowType: 'regel', parentId: 'b-parent', quantity: 1, normUnitPrice: 42 }),
      createItem({ rowType: 'staart_winst', staartPercentage: 10 }),
    ];
    const result = calculateProject(source);
    const active = getCalculationItems(result);
    expect(getKostprijs(active)).toBe(350);
    expect(getGrandTotal(active)).toBeCloseTo(385);
    expect(active.some(row => row.id === 'b-parent' || row.parentId === 'b-parent')).toBe(false);
    expect(result.items).toHaveLength(source.items.length);
    expect(parseProject(stringifyProject(result)).items).toEqual(result.items);
    result.schedule.activeBranchId = 'b';
    expect(getKostprijs(getCalculationItems(result))).toBe(1142);
    expect(getGrandTotal(getCalculationItems(result))).toBeCloseTo(1256.2);
    delete result.schedule.activeBranchId;
    expect(getKostprijs(getCalculationItems(result))).toBe(100);
    expect(calculateProject(result).items).toHaveLength(source.items.length);
  });

  it('sums repeated surcharge rows rather than dropping all but the last', () => {
    const source = createProject();
    source.items = [
      createItem({ rowType: 'regel', quantity: 1, normUnitPrice: 100 }),
      createItem({ rowType: 'staart_winst', staartPercentage: 10 }),
      createItem({ rowType: 'staart_winst', staartPercentage: 10 }),
      createItem({ rowType: 'staart_btw', staartPercentage: 21 }),
    ];
    const result = calculateProject(source);
    expect(getStaartBreakdown(result.items).winstAmount).toBeCloseTo(21);
    expect(getGrandTotal(result.items)).toBeCloseTo(146.41);
  });

  it('counts mixed-price labor norms and capacity consistently with upstream uren', () => {
    expect(getLaborHours([
      createItem({ rowType: 'regel', resourceType: 'materiaal', quantity: 10, normQuantity: 0.5, normFactor: 2 }),
      createItem({ rowType: 'regel', resourceType: 'arbeid', quantity: 2, normQuantity: 3, normFactor: 0 }),
      createItem({ rowType: 'chapter', quantity: 100, normQuantity: 100 }),
    ])).toBe(8.5);
  });

  it('does not mutate source rows and re-evaluates labor rates', () => {
    const source = createSampleProject();
    const before = structuredClone(source);
    const revised = calculateProject({ ...source, schedule: { ...source.schedule, tarieven: { A: 100 } } });
    expect(source).toEqual(before);
    expect(getKostprijs(revised.items)).toBeGreaterThan(getKostprijs(source.items));
  });

  it('cascades staart, applies low/high VAT over final rounded exclusive amount', () => {
    const source = createProject();
    source.items = [
      createItem({ rowType: 'regel', quantity: 1, normUnitPrice: 100, btwTarief: 'laag' }),
      createItem({ rowType: 'regel', quantity: 1, normUnitPrice: 300 }),
      createItem({ rowType: 'staart_winst', staartPercentage: 10 }),
      createItem({ rowType: 'staart_afronding', staartDoelbedrag: 450 }),
      createItem({ rowType: 'staart_btw_laag', staartPercentage: 9 }),
      createItem({ rowType: 'staart_btw', staartPercentage: 21 }),
    ];
    const result = calculateProject(source);
    const breakdown = getStaartBreakdown(result.items);
    expect(breakdown.afronding).toBe(10);
    expect(breakdown.btwLaagAmount).toBeCloseTo(10.125);
    expect(breakdown.btwAmount).toBeCloseTo(70.875);
    expect(getGrandTotal(result.items)).toBeCloseTo(531);
  });

  it('rejects duplicate ids, missing parents, cycles, nested staart, bad numbers and unknown row types', () => {
    const source = createProject();
    const row = createItem({ rowType: 'chapter', id: 'a' });
    for (const items of [
      [row, row], [{ ...row, parentId: 'missing' }], [{ ...row, parentId: 'a' }],
      [{ ...row, quantity: NaN }], [{ ...row, rowType: 'future' }],
      [row, createItem({ rowType: 'staart_winst', parentId: row.id })],
    ]) expect(() => validateProject({ ...source, items })).toThrow();
  });

  it('rejects UI metadata objects and malformed variant graphs at the boundary', () => {
    const source = createProject();
    for (const key of ['client', 'author', 'projectName', 'projectNumber', 'description', 'currency']) {
      expect(() => validateProject({ ...source, schedule: { ...source.schedule, [key]: { invalid: true } } })).toThrow();
    }
    for (const branches of [
      [{ id: 'a', name: 'A', parentId: 'a' }],
      [{ id: 'a', name: 'A', parentId: 'missing' }],
      [{ id: 'a', name: 'A', parentId: null }, { id: 'a', name: 'A', parentId: null }],
      [null],
    ]) expect(() => validateProject({ ...source, schedule: { ...source.schedule, branches } })).toThrow();
  });
});

describe('WPCalc MDB import', () => {
  it('opens the real upstream Jet MDB template and preserves original bytes', () => {
    const bytes = readFileSync(new URL('./fixtures/wpcalc-template.calc', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const project = importWpCalc(buffer, 'source.calc');
    expect(project.version).toBe('2.3.0');
    expect(project.items).toEqual([]);
    expect(project.schedule.directCostsOnly).toBe(true);
    expect(project.wpcalcSource).toEqual({ encoding: 'base64', fileName: 'source.calc', data: bytes.toString('base64'), importedRowIds: [], importedStaartRowIds: [], totals: { exclusive: null, inclusive: null } });
    expect(parseProject(stringifyProject(project)).wpcalcSource).toEqual(project.wpcalcSource);
  });

  it('rejects malformed and oversized MDB files', () => {
    expect(() => importWpCalc(new ArrayBuffer(128))).toThrow();
    expect(() => importWpCalc(new ArrayBuffer(13 * 1024 * 1024))).toThrow(/12 MB/);
  });

  it('maps combined W&R once and supports renamed rows with explicit bridge markers', () => {
    expect(resolveWpCalcStaartType('', 'Winst & Risico', 8)).toBe('staart_wr');
    expect(resolveWpCalcStaartType('', 'Winst & Risico', 2)).toBeNull();
    expect(resolveWpCalcStaartType('peercalc:staart_winst', 'Mijn opslag', 2)).toBe('staart_winst');
    expect(resolveWpCalcStaartType('', 'Btw laag', 256)).toBe('staart_btw_laag');
    expect(resolveWpCalcStaartType('', 'Totaal kolommen', 32)).toBeNull();
    expect(resolveWpCalcStaartType('', 'Onbekende rekenbasis', 16384)).toBeNull();
  });
});
