import { describe, expect, it } from 'vitest';
import MDBReader from 'mdb-reader';
import { Buffer } from 'buffer';
import { calculateProject, createProject, createItem, createSampleProject, getGrandTotal, getKostprijs, getLaborHours } from '../../src/domain';
import type { ProjectFile } from '../../src/domain';
import { importWpCalc } from '../../src/domain/wpcalc';

const endpoint = process.env.PEERCALC_TEST_CONVERTER_URL;
const token = process.env.PEERCALC_TEST_CONVERTER_TOKEN;
async function exportCalc(project: ProjectFile): Promise<ArrayBuffer> {
  const response = await fetch(`${endpoint}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error(`Converter ${response.status}: ${await response.text()}`);
  expect(response.headers.get('content-type')).toContain('application');
  return response.arrayBuffer();
}

describe.skipIf(!endpoint || !token)('live Java/MDB converter compatibility', () => {
  it('preserves explicit per-row hourly overrides and their labor-hour norms', async () => {
    const original = createProject('Rate override');
    original.schedule.tarieven = { A: 60 };
    original.items = [createItem({ rowType: 'regel', description: 'Explicit row rate', quantity: 2,
      normUnitPrice: 10, normQuantity: 0.5, laborPrice: 37.5, tariefGroep: null, wpcalcRateGroup: 'A' })];
    const calculated = calculateProject(original);
    const imported = importWpCalc(await exportCalc(calculated));
    expect(getKostprijs(imported.items)).toBe(95);
    expect(getLaborHours(imported.items)).toBe(getLaborHours(calculated.items));
    expect(imported.items[0].tariefGroep).toBeNull();
    expect(imported.items[0].normQuantity).toBe(0.5);
    expect(imported.items[0].wpcalcRateGroup).toBe('A');
  });

  it('round-trips a real MDB, edits/deletes managed rows and preserves original source row ids', async () => {
    const original = createSampleProject();
    const firstBytes = await exportCalc(original);
    const imported = importWpCalc(firstBytes, 'roundtrip.calc');
    expect(getKostprijs(imported.items)).toBeCloseTo(getKostprijs(original.items), 2);
    expect(getGrandTotal(imported.items)).toBeCloseTo(getGrandTotal(original.items), 2);
    const originalRows = original.items.filter(row => !row.rowType.startsWith('staart_'));
    expect(imported.items.filter(row => !row.rowType.startsWith('staart_'))).toHaveLength(originalRows.length);
    const resource = imported.items.find(row => row.rowType === 'regel')!;
    const deleted = imported.items.find(row => row.rowType === 'regel' && row.id !== resource.id)!;
    resource.quantity = (resource.quantity ?? 0) + 5;
    imported.items = imported.items.filter(row => row.id !== deleted.id);
    const profit = imported.items.find(row => row.rowType === 'staart_winst')!;
    profit.staartPercentage = 12.345;
    profit.description = 'Aangepaste opslag';
    const revised = calculateProject(imported);
    const secondBytes = await exportCalc(revised);
    const second = importWpCalc(secondBytes, 'roundtrip-edited.calc');
    expect(getKostprijs(second.items)).toBeCloseTo(getKostprijs(revised.items), 2);
    expect(getGrandTotal(second.items)).toBeCloseTo(getGrandTotal(revised.items), 2);
    expect(second.items.find(row => row.wpcalcRowId === resource.wpcalcRowId)?.quantity).toBe(resource.quantity);
    expect(second.items.find(row => row.wpcalcRowId === deleted.wpcalcRowId)).toBeUndefined();
    expect(second.items.find(row => row.rowType === 'staart_winst')?.description).toBe('Aangepaste opslag');
    const reader = new MDBReader(Buffer.from(secondBytes));
    expect(reader.getTableNames()).toContain('uittrekstaten');
    const dbRows = reader.getTable('data').getData();
    expect(dbRows.some(row => row.recnr === deleted.wpcalcRowId)).toBe(false);
    expect(dbRows.some(row => row.recnr === resource.wpcalcRowId)).toBe(true);
  });
});
