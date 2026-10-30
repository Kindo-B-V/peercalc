import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import MDBReader from 'mdb-reader';
import { importWpCalc } from '../../src/domain/wpcalc';
import { calculateProject, computeKostprijsBreakdown, getGrandTotal, getKostprijs, getLaborHours, getStaartBreakdown, parseProject, stringifyProject } from '../../src/domain';

const file = process.env.PEERCALC_PRIVATE_CALC_FILE;
const endpoint = process.env.PEERCALC_TEST_CONVERTER_URL;
const token = process.env.PEERCALC_TEST_CONVERTER_TOKEN;
const cents = (value: number) => Math.round(value * 100) / 100;

// Private fixtures remain outside the repository; all expectations come from their MDB tables.
describe.skipIf(!file)('opt-in private WPCalc source compatibility', () => {
  it('matches saved source costs and hours and retains native/source metadata', () => {
    const bytes = readFileSync(file!);
    const reader = new MDBReader(bytes);
    const source = reader.getTable('calculaties').getData()[0];
    const data = reader.getTable('data').getData();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const project = importWpCalc(buffer, 'private-source.calc');
    const recalculated = calculateProject(project);
    const direct = data.filter(row => row.rectype === 0).reduce((sum, row) => sum + Number(row.aantal ?? 0) * Number(row.kosteneh ?? 0), 0);
    const totals = getStaartBreakdown(recalculated.items);
    expect(cents(getKostprijs(recalculated.items))).toBe(cents(direct));
    expect(cents(getGrandTotal(recalculated.items))).toBe(cents(Number(source.totaalinclbtw)));
    expect(cents(getGrandTotal(recalculated.items) - totals.btwAmount - totals.btwLaagAmount)).toBe(cents(Number(source.totaalexclbtw)));
    expect(cents(getLaborHours(recalculated.items))).toBe(cents(Number(source.totaaluren)));
    const resourceSummary = reader.getTable('staart').getData().find(row => row.itemtype === 32)!;
    const resources = computeKostprijsBreakdown(recalculated.items);
    for (const key of ['loon', 'materiaal', 'materieel', 'stelpost', 'onderaanneming'] as const) {
      expect(cents(resources[key])).toBe(cents(Number(resourceSummary[key])));
    }
    const uncalculated = data.filter(row => row.rectype === 0 && row.kosteneh == null && Number(row.prijs ?? 0) !== 0);
    expect(recalculated.items.filter(row => row.wpcalcUncalculatedPrice === true)).toHaveLength(uncalculated.length);
    for (const row of uncalculated) {
      const imported = recalculated.items.find(item => item.wpcalcRowId === row.recnr)!;
      expect(imported.wpcalcOriginalPrice).toBe(row.prijs);
      expect(imported.quantity).toBe(row.aantal);
      expect(imported.total).toBe(0);
    }
    expect(isDeepStrictEqual(parseProject(stringifyProject(recalculated)), recalculated)).toBe(true);
    expect((recalculated.wpcalcSource as { data: string }).data === bytes.toString('base64')).toBe(true);
  });

  it.skipIf(!endpoint || !token)('exports the private source, preserves opaque tables, and reimports edited costs', async () => {
    const bytes = readFileSync(file!);
    const sourceDb = new MDBReader(bytes);
    const original = importWpCalc(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const exportDocument = async (document: typeof original) => {
      const response = await fetch(`${endpoint}/export`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(document) });
      if (!response.ok) throw new Error(`Private source export failed with HTTP ${response.status}`);
      return response.arrayBuffer();
    };
    const exported = await exportDocument(original);
    const exportedDb = new MDBReader(Buffer.from(exported));
    const reopened = importWpCalc(exported);
    expect(cents(getGrandTotal(reopened.items))).toBe(cents(getGrandTotal(original.items)));
    expect(cents(getLaborHours(reopened.items))).toBe(cents(getLaborHours(original.items)));
    for (const table of sourceDb.getTableNames().filter(name => !['calculaties', 'data', 'staart', 'tarieven', 'uren'].includes(name))) {
      expect(isDeepStrictEqual(exportedDb.getTable(table).getData(), sourceDb.getTable(table).getData())).toBe(true);
    }
    const assertHourCache = (reader: MDBReader, document: typeof original) => {
      for (const cached of reader.getTable('uren').getData()) {
        const rows = document.items.filter(item => item.rowType === 'regel' && (cached.tariefgroep == null || (item.tariefGroep ?? item.wpcalcRateGroup) === cached.tariefgroep));
        expect(cents(Number(cached.aantal))).toBe(cents(getLaborHours(rows)));
        expect(cents(Number(cached.bedrag))).toBe(cents(rows.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.laborPrice ?? 0), 0)));
      }
    };
    assertHourCache(exportedDb, original);
    expect(exportedDb.getTable('tarieven').getData()).toHaveLength(sourceDb.getTable('tarieven').getData().length);
    expect(exportedDb.getTable('data').getData()).toHaveLength(sourceDb.getTable('data').getData().length);
    const originalData = sourceDb.getTable('data');
    const exportedData = new Map(exportedDb.getTable('data').getData().map(row => [row.recnr, row]));
    const changedFields = new Map<string, number>();
    for (const source of originalData.getData()) {
      const result = exportedData.get(source.recnr)!;
      for (const key of originalData.getColumnNames()) {
        const before = source[key], after = result?.[key];
        const equal = typeof before === 'number' && typeof after === 'number'
          ? Math.abs(before - after) <= Math.max(1e-8, Math.abs(before) * 1e-12)
          : isDeepStrictEqual(before, after);
        if (!equal) changedFields.set(key, (changedFields.get(key) ?? 0) + 1);
      }
    }
    // Report only schema/count differences, never private record values or descriptions.
    expect([...changedFields]).toEqual([]);
    const originalTail = sourceDb.getTable('staart');
    const resultTail = new Map(exportedDb.getTable('staart').getData().map(row => [row.recnr, row]));
    const recalculatedTailFields = new Set(['loon', 'materiaal', 'materieel', 'stelpost', 'onderaanneming', 'bedrag', 'subtotaal', 'totaal']);
    const changedTailFields = new Map<string, number>();
    expect(resultTail.size).toBe(originalTail.getData().length);
    for (const source of originalTail.getData()) {
      const result = resultTail.get(source.recnr)!;
      for (const key of originalTail.getColumnNames().filter(name => !recalculatedTailFields.has(name))) {
        const before = source[key], after = result?.[key];
        const equal = typeof before === 'number' && typeof after === 'number'
          ? Math.abs(before - after) <= 1e-10
          : isDeepStrictEqual(before, after);
        if (!equal) changedTailFields.set(key, (changedTailFields.get(key) ?? 0) + 1);
      }
    }
    expect([...changedTailFields]).toEqual([]);
    const originalUncalculated = original.items.filter(row => row.wpcalcUncalculatedPrice === true);
    for (const row of originalUncalculated) {
      const source = sourceDb.getTable('data').getData().find(record => record.recnr === row.wpcalcRowId)!;
      const result = exportedDb.getTable('data').getData().find(record => record.recnr === row.wpcalcRowId)!;
      for (const key of ['aantal', 'prijs', 'kosteneh', 'norm', 'tarief', 'tariefgroep']) expect(result[key] === source[key]).toBe(true);
    }
    const edited = structuredClone(original);
    const row = edited.items.find(item => item.rowType === 'regel' && !item.wpcalcQuantityFormula
      && !item.wpcalcUncalculatedPrice && item.quantity !== null && item.quantity > 0 && item.normUnitPrice !== null)!;
    row.quantity = (row.quantity ?? 0) + 1;
    row.normUnitPrice = (row.normUnitPrice ?? 0) + 0.5;
    row.notes = 'Synthetic integration note';
    const calculated = calculateProject(edited);
    const updatedBytes = await exportDocument(calculated);
    const updated = importWpCalc(updatedBytes);
    expect(cents(getGrandTotal(updated.items))).toBe(cents(getGrandTotal(calculated.items)));
    expect(cents(getKostprijs(updated.items))).toBe(cents(getKostprijs(calculated.items)));
    expect(updated.items.find(item => item.wpcalcRowId === row.wpcalcRowId)?.notes === row.notes).toBe(true);
    const updatedDb = new MDBReader(Buffer.from(updatedBytes));
    assertHourCache(updatedDb, calculated);
    expect(isDeepStrictEqual(updatedDb.getTable('uittrekstaten').getData(), sourceDb.getTable('uittrekstaten').getData())).toBe(true);
  });
});
