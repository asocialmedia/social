export function placeExploreItems(
  previous: readonly (readonly string[])[],
  ids: readonly string[],
  count: number
): string[][] {
  const present = new Set(ids);
  const columns = Array.from({ length: count }, (_, index) =>
    previous.length === count
      ? previous[index].filter((id) => present.has(id))
      : []
  );
  const known = new Set(columns.flat());
  for (const id of ids) {
    if (known.has(id)) {
      continue;
    }
    let shortest = 0;
    for (let index = 1; index < columns.length; index += 1) {
      if (columns[index].length < columns[shortest].length) {
        shortest = index;
      }
    }
    columns[shortest].push(id);
    known.add(id);
  }
  return columns;
}
