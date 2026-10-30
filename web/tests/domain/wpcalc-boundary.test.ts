import { describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock('mdb-reader', () => ({ default: class {
  getTableNames() { return Object.keys(source.tables); }
  getTable(name: string) { return { getData: () => source.tables[name] }; }
} }));
import { importWpCalcFile } from '../../src/domain/wpcalcImporter';

describe('WPCalc document isolation', () => {
  it('rejects multiple calculations before merging their rows', () => {
    source.tables = { calculaties: [{ docnr: 1 }, { docnr: 2 }], data: [] };
    expect(() => importWpCalcFile(new ArrayBuffer(0))).toThrow('Multi-document');
  });
  for (const table of ['data', 'tarieven', 'staart']) {
    it(`rejects foreign calculation records in ${table}`, () => {
      source.tables = { calculaties: [{ docnr: 1 }], data: [], [table]: [{ docnr: 2 }] };
      expect(() => importWpCalcFile(new ArrayBuffer(0))).toThrow('another calculation');
    });
  }
  it('rejects orphan records when calculation metadata is absent', () => {
    source.tables = { calculaties: [], data: [{ docnr: 1 }] };
    expect(() => importWpCalcFile(new ArrayBuffer(0))).toThrow('another calculation');
  });
  it('accepts a truly empty template and a single matching calculation', () => {
    source.tables = { calculaties: [], data: [] };
    expect(importWpCalcFile(new ArrayBuffer(0)).items).toEqual([]);
    source.tables = { calculaties: [{ docnr: 7, calculatietitel: 'Single' }], data: [], tarieven: [{ docnr: 7, tariefgroep: 'A', tarief: 60 }] };
    expect(importWpCalcFile(new ArrayBuffer(0)).schedule.name).toEqual('Single');
  });
});
