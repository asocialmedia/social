// Hermes lacks the ES2023 copying array methods. Keep ordering immutable without
// relying on those methods or the lint fixer rewriting Array.sort into toSorted.
export function orderedCopy<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number
): T[] {
  const ordered: T[] = [];
  for (const value of values) {
    let index = ordered.length;
    while (index > 0 && compare(value, ordered[index - 1]) < 0) {
      index -= 1;
    }
    ordered.splice(index, 0, value);
  }
  return ordered;
}

export function reversedCopy<T>(values: readonly T[]): T[] {
  const reversed: T[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    reversed.push(values[index]);
  }
  return reversed;
}
