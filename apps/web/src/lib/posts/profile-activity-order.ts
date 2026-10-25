export function profileActivityOrder<
  T extends { id: string; type: string; at: string },
>(rows: T[]): T[] {
  return [
    ...new Map(rows.map((row) => [`${row.type}:${row.id}`, row])).values(),
  ].toSorted(
    (first, second) =>
      Date.parse(second.at) - Date.parse(first.at) ||
      first.id.localeCompare(second.id)
  );
}
