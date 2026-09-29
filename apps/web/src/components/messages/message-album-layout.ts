// Bento layouts for grouped image albums.
//
// Each layout is an ASCII map where a repeated letter is one tile and the map
// itself is the grid: every character is one square base cell, so a tile's
// column span / row span are its letter's rectangle. The container gets
// `aspect-ratio: cols / rows`, which makes every base cell square and keeps the
// collage free of holes and half-cells. The first tile (A) is the hero and is
// always the sender's first image; the last letter lands bottom-right so the
// grid's rounded outer corners map onto the first and last images.
//
// Selection: a 2x2 hero (or two half-width heroes) anchors each count, with the
// remaining tiles filling the rectangle at varied sizes - that asymmetry is what
// reads as "bento" rather than a uniform contact sheet. This module is pure so
// the shapes can be asserted in tests; message-album-layout.test.ts verifies
// every entry is rectangular and hole-free.

export interface AlbumTilePlacement {
  col: number;
  colSpan: number;
  id: string;
  row: number;
  rowSpan: number;
}

export interface AlbumLayout {
  cols: number;
  placements: AlbumTilePlacement[];
  rows: number;
}

export const ALBUM_LAYOUTS: Record<number, readonly string[]> = {
  10: ["AABC", "AADE", "FGHH", "IIJJ"],
  2: ["AB"],
  3: ["AAB", "AAC"],
  4: ["AAB", "AAC", "DDD"],
  5: ["AAB", "AAC", "DDE"],
  6: ["AAB", "AAC", "DEF"],
  7: ["AABC", "AADE", "FFGG"],
  8: ["AABC", "AADE", "FFGH"],
  9: ["AABC", "AADE", "FGHI"],
};

// Parses an ASCII layout into explicit grid placements, in reading order (A
// first) so image index === placement index.
export function parseAlbumLayout(rows: readonly string[]): AlbumLayout {
  const cols = rows[0]?.length ?? 0;
  const bounds = new Map<
    string,
    { maxCol: number; maxRow: number; minCol: number; minRow: number }
  >();
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row];
    for (let col = 0; col < line.length; col += 1) {
      const id = line[col];
      // Space marks a hole so malformed maps can be detected rather than
      // silently becoming a tile.
      if (id === " ") {
        continue;
      }
      const current = bounds.get(id) ?? {
        maxCol: col,
        maxRow: row,
        minCol: col,
        minRow: row,
      };
      current.maxCol = Math.max(current.maxCol, col);
      current.maxRow = Math.max(current.maxRow, row);
      current.minCol = Math.min(current.minCol, col);
      current.minRow = Math.min(current.minRow, row);
      bounds.set(id, current);
    }
  }
  const placements = [...bounds.entries()].map(([id, box]) => ({
    col: box.minCol,
    colSpan: box.maxCol - box.minCol + 1,
    id,
    row: box.minRow,
    rowSpan: box.maxRow - box.minRow + 1,
  }));
  return { cols, placements, rows: rows.length };
}

const PARSED_ALBUM_LAYOUTS = new Map<number, AlbumLayout>(
  Object.entries(ALBUM_LAYOUTS).map(([count, rows]) => [
    Number(count),
    parseAlbumLayout(rows),
  ])
);

// Falls back to a uniform grid for any count without a bespoke layout (never
// reached for valid albums, which the payload validator caps at 10).
export function getAlbumLayout(count: number): AlbumLayout {
  const layout = PARSED_ALBUM_LAYOUTS.get(count);
  if (layout) {
    return layout;
  }
  const cols = Math.min(count, 3);
  const rows = Math.ceil(count / cols);
  const placements: AlbumTilePlacement[] = Array.from(
    { length: count },
    (_, index) => ({
      col: index % cols,
      colSpan: 1,
      id: `tile-${index}`,
      row: Math.floor(index / cols),
      rowSpan: 1,
    })
  );
  return { cols, placements, rows };
}

// Shape validation used by tests: every row must be the same width, every
// letter must form a filled rectangle (its area equals its bounding box), and
// the tile count must equal the image count the layout is keyed by.
export function isWellFormedAlbumLayout(
  rows: readonly string[],
  expectedCount: number
): boolean {
  const layout = parseAlbumLayout(rows);
  if (layout.cols === 0 || layout.placements.length !== expectedCount) {
    return false;
  }
  const area = new Map<string, number>();
  for (const line of rows) {
    if (line.length !== layout.cols) {
      return false;
    }
    for (const id of line) {
      area.set(id, (area.get(id) ?? 0) + 1);
    }
  }
  // A rectangle is the only shape whose area equals width * height; parseAlbumLayout
  // collapsed each letter to its bounding box, so a match means each letter is
  // rectangular.
  const rectangular = layout.placements.every(
    (placement) =>
      area.get(placement.id) === placement.colSpan * placement.rowSpan
  );
  if (!rectangular) {
    return false;
  }
  // Definitive partition check: paint every placement's bounding box and make
  // sure each base cell is claimed exactly once (no overlap, no holes).
  const grid = Array.from({ length: layout.cols * layout.rows }, () => 0);
  for (const placement of layout.placements) {
    for (
      let { row } = placement;
      row < placement.row + placement.rowSpan;
      row += 1
    ) {
      for (
        let { col } = placement;
        col < placement.col + placement.colSpan;
        col += 1
      ) {
        const index = row * layout.cols + col;
        grid[index] += 1;
        if (grid[index] > 1) {
          return false;
        }
      }
    }
  }
  return grid.every((claims) => claims === 1);
}
