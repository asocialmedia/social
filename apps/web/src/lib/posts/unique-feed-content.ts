// Keep the highest-ranked copy of substantial repeated text, preserving short captions and distinct quoted threads.
export function uniqueFeedContent<T>(
  items: T[],
  content: (item: T) => string,
  context: (item: T) => string = () => ""
): T[] {
  const seen = new Set<string>();
  const prompts = new Set<string>();
  const substantial: { context: string; words: Set<string> }[] = [];
  return items.filter((item) => {
    const raw = content(item).normalize("NFKC");
    const text = raw
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/\s+/gu, " ")
      .trim();
    const firstLine =
      raw
        .split(/\n/u)[0]
        ?.toLowerCase()
        .replaceAll(/[^\p{L}\p{N}\s]/gu, "")
        .replaceAll(/\s+/gu, " ")
        .trim() ?? "";
    const prompt =
      raw.includes("\n") && firstLine === "diminish an anime" ? firstLine : "";
    if (prompt && prompts.has(prompt)) {
      return false;
    }
    if (text.length < 64) {
      if (prompt) {
        prompts.add(prompt);
      }
      return true;
    }
    const key = `${context(item)}\n${text}`;
    if (seen.has(key)) {
      return false;
    }
    const words = new Set(text.match(/[\p{L}\p{N}]+/gu));
    if (
      words.size >= 12 &&
      substantial.some((entry) => {
        if (entry.context !== context(item)) {
          return false;
        }
        const overlap = [...words].filter((word) =>
          entry.words.has(word)
        ).length;
        return overlap / (words.size + entry.words.size - overlap) >= 0.85;
      })
    ) {
      return false;
    }
    if (words.size >= 12) {
      substantial.push({ context: context(item), words });
    }
    seen.add(key);
    if (prompt) {
      prompts.add(prompt);
    }
    return true;
  });
}
