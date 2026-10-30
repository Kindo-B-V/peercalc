import { describe, expect, it } from "vitest";
import {
  getVirtualRows,
  GRID_ROW_HEIGHT,
} from "../../src/client/use-grid-virtualizer";

describe("fixed-height estimate viewport", () => {
  it("renders a bounded window at either end of a 20,000-row estimate", () => {
    const top = getVirtualRows(20000, 0, 600);
    expect(top.entries[0].index).toBe(0);
    expect(top.entries.length).toBeLessThan(50);
    const bottom = getVirtualRows(20000, 20000 * GRID_ROW_HEIGHT - 500, 600);
    expect(bottom.entries.at(-1)?.index).toBe(19999);
    expect(bottom.entries.length).toBeLessThan(50);
    expect(bottom.bottomRows).toBe(0);
  });
  it("pins the focused row without rendering the intervening rows or changing total height", () => {
    const result = getVirtualRows(20000, 15000 * GRID_ROW_HEIGHT, 600, 2);
    expect(result.entries.some((entry) => entry.index === 2)).toBe(true);
    expect(result.entries.length).toBeLessThan(50);
    const rows =
      result.entries.length +
      result.entries.reduce((sum, entry) => sum + entry.gapBefore, 0) +
      result.bottomRows;
    expect(rows).toBe(20000);
  });
  it("handles empty and short estimates without phantom rows", () => {
    expect(getVirtualRows(0, 0, 600)).toEqual({ entries: [], bottomRows: 0 });
    expect(
      getVirtualRows(3, 0, 600).entries.map((entry) => entry.index),
    ).toEqual([0, 1, 2]);
  });
});
