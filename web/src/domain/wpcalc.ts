import { Buffer } from 'buffer';
import { importWpCalcFile } from './wpcalcImporter';
import { calculateProject, createProject, getGrandTotal, getStaartBreakdown } from './index';
import type { ProjectFile } from './types';

/** Retain the original MDB so the export service can preserve unedited tables. */
export function importWpCalc(buffer: ArrayBuffer, fileName = 'begroting.calc'): ProjectFile {
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error('WPCalc files may be at most 12 MB.');
  const imported = importWpCalcFile(buffer);
  const defaults = createProject(imported.schedule.name);
  const result = calculateProject({
    ...defaults, schedule: { ...defaults.schedule, ...imported.schedule }, items: imported.items, companyInfo: imported.companyInfo,
    wpcalcSource: {
      encoding: 'base64', data: Buffer.from(buffer).toString('base64'), fileName,
      importedRowIds: imported.items.flatMap(row => typeof row.wpcalcRowId === 'number' ? [row.wpcalcRowId] : []),
      importedStaartRowIds: imported.items.flatMap(row => typeof row.wpcalcStaartRowId === 'number' ? [row.wpcalcStaartRowId] : []),
      totals: imported.sourceTotals,
    },
  });
  for (const row of result.items) {
    if (typeof row.wpcalcCachedUnitPrice !== 'number') continue;
    const expected = row.wpcalcCachedUnitPrice * (row.quantity ?? 0);
    const tolerance = Math.max(0.02, Math.abs(row.quantity ?? 0) * 0.0001);
    if (Math.abs(row.total - expected) > tolerance) {
      throw new Error(`WPCalc row "${row.description}" recalculates differently from its saved price. This source calculation requires additional mapping; the original file has not been changed.`);
    }
  }
  const breakdown = getStaartBreakdown(result.items);
  const inclusive = getGrandTotal(result.items);
  const exclusive = inclusive - breakdown.btwAmount - breakdown.btwLaagAmount;
  for (const [kind, actual] of [['exclusive', exclusive], ['inclusive', inclusive]] as const) {
    const expected = imported.sourceTotals[kind];
    if (expected !== null && expected !== 0 && Math.abs(expected - actual) > 0.02) {
      throw new Error(`WPCalc ${kind} total differs from the saved source total. This calculation requires additional mapping; the original file has not been changed.`);
    }
  }
  return result;
}
