import "@formatjs/intl-displaynames/polyfill.js";
import "@formatjs/intl-displaynames/locale-data/en.js";
import { orderedCopy } from "@/lib/format/ordered-copy";

export function networkDisplayNames() {
  return {
    language: new Intl.DisplayNames(["en"], { type: "language" }),
    region: new Intl.DisplayNames(["en"], { type: "region" }),
  };
}

export function networkLocaleChoices(
  names: Intl.DisplayNames,
  type: "language" | "region"
) {
  const first = type === "language" ? 97 : 65;
  const choices = Array.from({ length: 676 }, (_, index) =>
    String.fromCodePoint(first + Math.floor(index / 26), first + (index % 26))
  )
    .map((code) => ({ code, label: names.of(code) ?? code }))
    .filter(
      (entry) =>
        entry.code !== entry.label &&
        (type === "language" ? !entry.label.includes("(") : entry.code !== "ZZ")
    );
  return orderedCopy(choices, (left, right) =>
    left.label.localeCompare(right.label)
  );
}
