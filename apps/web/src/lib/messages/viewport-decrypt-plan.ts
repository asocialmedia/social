export function viewportDecryptPlan<T extends { id: string }>(
  messages: readonly T[],
  visibleIds: readonly string[],
  padding: number
): { urgent: T[]; prefetch: T[] } {
  const byId = new Map(
    messages.map((message, index) => [message.id, { index, message }])
  );
  const visible = [...new Set(visibleIds)].flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  if (!visible.length) {
    const last = messages.at(-1);
    return { prefetch: [], urgent: last ? [last] : [] };
  }
  const first = Math.min(...visible.map((entry) => entry.index));
  const last = Math.max(...visible.map((entry) => entry.index));
  const prefetch: T[] = [];
  for (
    let index = first - 1;
    index >= Math.max(0, first - padding);
    index -= 1
  ) {
    const message = messages[index];
    if (message) {
      prefetch.push(message);
    }
  }
  for (
    let index = last + 1;
    index <= Math.min(messages.length - 1, last + padding);
    index += 1
  ) {
    const message = messages[index];
    if (message) {
      prefetch.push(message);
    }
  }
  return { prefetch, urgent: visible.map((entry) => entry.message) };
}
