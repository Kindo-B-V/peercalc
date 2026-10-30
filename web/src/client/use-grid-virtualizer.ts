// Adapted from Open Calc Studio's useGridVirtualizer.ts (LGPL-3.0-only), fixed-height subset.
import { useEffect, useMemo, useState, type RefObject } from "react";

export const GRID_ROW_HEIGHT = 37;
const HEADER_HEIGHT = 37;
const OVERSCAN = 8;

export function getVirtualRows(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  focusedIndex = -1,
) {
  const firstVisible = Math.min(
    Math.max(0, totalRows - 1),
    Math.floor(Math.max(0, scrollTop - HEADER_HEIGHT) / GRID_ROW_HEIGHT),
  );
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(
    totalRows,
    Math.ceil(
      Math.max(0, scrollTop + viewportHeight - HEADER_HEIGHT) / GRID_ROW_HEIGHT,
    ) + OVERSCAN,
  );
  const indices = Array.from(
    { length: Math.max(0, end - start) },
    (_, offset) => start + offset,
  );
  if (
    focusedIndex >= 0 &&
    focusedIndex < totalRows &&
    !indices.includes(focusedIndex)
  )
    indices.push(focusedIndex);
  indices.sort((a, b) => a - b);
  const entries = indices.map((index, position) => ({
    index,
    gapBefore: index - (indices[position - 1] ?? -1) - 1,
  }));
  return { entries, bottomRows: totalRows - (indices.at(-1) ?? -1) - 1 };
}

export function useGridVirtualizer(
  ref: RefObject<HTMLDivElement | null>,
  totalRows: number,
  focusedIndex: number,
  resetKey: string,
  enabled: boolean,
) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    let frame = 0;
    const measure = () => {
      setViewport((previous) =>
        previous.scrollTop === element.scrollTop &&
        previous.height === element.clientHeight
          ? previous
          : { scrollTop: element.scrollTop, height: element.clientHeight },
      );
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [ref, enabled]);
  useEffect(() => {
    if (enabled && ref.current) {
      ref.current.scrollTop = 0;
      setViewport((previous) => ({ ...previous, scrollTop: 0 }));
    }
  }, [ref, resetKey, enabled]);
  return useMemo(
    () =>
      getVirtualRows(
        totalRows,
        viewport.scrollTop,
        viewport.height,
        focusedIndex,
      ),
    [totalRows, viewport, focusedIndex],
  );
}
