export function mergeSharedReferencePages<T extends { key: string }>(
  pages: Iterable<{ rows: T[] }>
): T[] {
  const rows = new Map<string, T>();
  for (const page of pages) {
    for (const row of page.rows) {
      rows.set(row.key, row);
    }
  }
  return [...rows.values()];
}
