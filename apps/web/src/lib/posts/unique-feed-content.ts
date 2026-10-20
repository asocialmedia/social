// Keep the highest-ranked copy of substantial repeated text, preserving short captions and distinct quoted threads.
export function uniqueFeedContent<T>(
  items: T[],
  content: (item: T) => string,
  context: (item: T) => string = () => ""
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const text = content(item)
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/\s+/gu, " ")
      .trim();
    if (text.length < 64) {
      return true;
    }
    const key = `${context(item)}\n${text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
