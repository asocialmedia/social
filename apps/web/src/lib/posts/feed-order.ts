// Keep pagination below the reader even when a generator returns newer dates.
// Only items explicitly prepended to a source may move ahead of existing rows.
export function reconcileFeedOrder<T extends { id: string }>(
  previous: readonly T[],
  incoming: readonly T[],
  sourceOrders: readonly (readonly string[])[]
): T[] {
  const previousIds = new Set(previous.map((item) => item.id));
  const current = new Map(incoming.map((item) => [item.id, item]));
  if (!previous.some((item) => current.has(item.id))) {
    return [...incoming];
  }
  const prepended = new Set<string>();
  for (const ids of sourceOrders) {
    const firstKnown = ids.findIndex((id) => previousIds.has(id));
    if (firstKnown > 0) {
      for (const id of ids.slice(0, firstKnown)) {
        prepended.add(id);
      }
    }
  }
  return [
    ...incoming.filter((item) => prepended.has(item.id)),
    ...previous.flatMap((item) => {
      const updated = current.get(item.id);
      return updated ? [updated] : [];
    }),
    ...incoming.filter(
      (item) => !previousIds.has(item.id) && !prepended.has(item.id)
    ),
  ];
}
