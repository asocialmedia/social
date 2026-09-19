import { describe, expect, test } from "bun:test";

import {
  ALBUM_LAYOUTS,
  getAlbumLayout,
  isWellFormedAlbumLayout,
  parseAlbumLayout,
} from "./message-album-layout";

describe("ALBUM_LAYOUTS", () => {
  test("covers every supported count from 2 to 10", () => {
    expect(
      Object.keys(ALBUM_LAYOUTS)
        .map(Number)
        .toSorted((a, b) => a - b)
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test.each(Object.entries(ALBUM_LAYOUTS))(
    "layout %s is rectangular, hole-free, and has one tile per image",
    (count, rows) => {
      expect(isWellFormedAlbumLayout(rows, Number(count))).toBe(true);
    }
  );

  test("every layout except the two-up has a hero tile larger than a single cell", () => {
    for (const [count, rows] of Object.entries(ALBUM_LAYOUTS)) {
      const [hero] = parseAlbumLayout(rows).placements;
      expect(hero).toBeDefined();
      if (count === "2") {
        expect(hero.colSpan * hero.rowSpan).toBe(1);
      } else {
        expect(hero.colSpan * hero.rowSpan).toBeGreaterThan(1);
      }
    }
  });

  test("every layout's last tile ends at the bottom-right corner", () => {
    for (const rows of Object.values(ALBUM_LAYOUTS)) {
      const layout = parseAlbumLayout(rows);
      const last = layout.placements.at(-1);
      expect(last).toBeDefined();
      expect(last?.row + (last?.rowSpan ?? 0)).toBe(layout.rows);
      expect(last?.col + (last?.colSpan ?? 0)).toBe(layout.cols);
    }
  });
});

describe("parseAlbumLayout", () => {
  test("maps repeated letters to their bounding rectangles in reading order", () => {
    expect(parseAlbumLayout(["AAB", "AAC", "DDE"])).toEqual({
      cols: 3,
      placements: [
        { col: 0, colSpan: 2, id: "A", row: 0, rowSpan: 2 },
        { col: 2, colSpan: 1, id: "B", row: 0, rowSpan: 1 },
        { col: 2, colSpan: 1, id: "C", row: 1, rowSpan: 1 },
        { col: 0, colSpan: 2, id: "D", row: 2, rowSpan: 1 },
        { col: 2, colSpan: 1, id: "E", row: 2, rowSpan: 1 },
      ],
      rows: 3,
    });
  });
});

describe("isWellFormedAlbumLayout", () => {
  test("rejects a layout with a hole", () => {
    expect(isWellFormedAlbumLayout(["AB", " C"], 3)).toBe(false);
  });

  test("rejects a layout with overlapping tiles", () => {
    // A appears in a non-rectangular shape (an L), which also overlaps B.
    expect(isWellFormedAlbumLayout(["AAB", "ABB", "CCC"], 3)).toBe(false);
  });

  test("rejects a tile count that does not match the image count", () => {
    expect(isWellFormedAlbumLayout(["AB", "CD"], 3)).toBe(false);
  });

  test("rejects ragged rows", () => {
    expect(isWellFormedAlbumLayout(["ABC", "DE"], 5)).toBe(false);
  });
});

describe("getAlbumLayout", () => {
  test("returns the bespoke layout for a supported count", () => {
    expect(getAlbumLayout(2)).toEqual(parseAlbumLayout(ALBUM_LAYOUTS[2]));
    expect(getAlbumLayout(10)).toEqual(parseAlbumLayout(ALBUM_LAYOUTS[10]));
  });

  test("falls back to a uniform grid beyond the supported range", () => {
    const layout = getAlbumLayout(12);
    expect(layout.placements).toHaveLength(12);
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(4);
    expect(
      layout.placements.every(
        (placement) => placement.colSpan === 1 && placement.rowSpan === 1
      )
    ).toBe(true);
  });
});
