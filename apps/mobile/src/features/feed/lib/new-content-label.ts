// Web NewContentPill's label: the count caps at "20+", and the noun is
// pluralised on the real count.
export function newContentLabel(count: number, noun = "post"): string {
  const shown = count > 20 ? "20+" : String(count);
  return `${shown} new ${noun}${count === 1 ? "" : "s"}`;
}
