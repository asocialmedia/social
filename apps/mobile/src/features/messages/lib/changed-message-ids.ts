interface CiphertextRow {
  ciphertext: string;
  id: string;
  iv: string;
  ratchetIndex: number;
}

export function changedMessageIds(
  previous: readonly CiphertextRow[],
  incoming: readonly CiphertextRow[]
): string[] {
  const known = new Map(previous.map((row) => [row.id, row]));
  return incoming.flatMap((row) => {
    const old = known.get(row.id);
    return old &&
      (old.ciphertext !== row.ciphertext ||
        old.iv !== row.iv ||
        old.ratchetIndex !== row.ratchetIndex)
      ? [row.id]
      : [];
  });
}
