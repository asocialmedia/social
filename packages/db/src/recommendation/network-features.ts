import { normalizeInterest } from "@asm/protocols/discovery";
import { francAll } from "franc-min";
import model from "wink-eng-lite-web-model";
import winkNLP from "wink-nlp";

const nlp = winkNLP(model, ["sbd", "pos"]);
// wink-nlp's declarations misdescribe the internal addon argument; preserve the helper's identity for its runtime dispatcher.
const lemma = nlp.its.lemma as unknown as typeof nlp.its.normal;

// Metadata remains authoritative across languages; the lightweight English model only adds weak lexical context.
export function networkContentTopics(
  text: string,
  declared: readonly string[] = [],
  languages: readonly string[] = []
): string[] {
  const explicit = [
    ...declared,
    ...(text.match(/#[\p{L}\p{N}\p{M}_-]+/gu) ?? []),
  ].map(normalizeInterest);
  const english =
    !languages.length ||
    languages.some((language) => language.split("-")[0] === "en");
  const nouns = english
    ? nlp
        .readDoc(text.slice(0, 4000).replaceAll(/https?:\/\/\S+/gu, " "))
        .tokens()
        .filter(
          (token) =>
            ["NOUN", "PROPN"].includes(token.out(nlp.its.pos)) &&
            !token.out(nlp.its.stopWordFlag)
        )
        .out(lemma)
    : [];
  return [...new Set([...explicit, ...nouns.map(normalizeInterest)])]
    .filter((topic) => topic.length >= 2 && topic.length <= 64)
    .slice(0, 20);
}

const iso3: Record<string, string> = {
  ar: "arb",
  bn: "ben",
  de: "deu",
  el: "ell",
  en: "eng",
  es: "spa",
  fr: "fra",
  hi: "hin",
  id: "ind",
  it: "ita",
  ja: "jpn",
  ko: "kor",
  mr: "mar",
  nl: "nld",
  pt: "por",
  ru: "rus",
  sv: "swe",
  ta: "tam",
  te: "tel",
  tr: "tur",
  uk: "ukr",
  ur: "urd",
  vi: "vie",
  zh: "cmn",
};

export function networkLanguageMatches(
  text: string,
  languages: readonly string[],
  preference: string
): boolean {
  if (["auto", "all"].includes(preference)) {
    return true;
  }
  if (languages.length) {
    return languages.some(
      (language) => language.toLowerCase().split("-")[0] === preference
    );
  }
  if (text.replaceAll(/[^\p{L}]/gu, "").length < 60) {
    return true;
  }
  const [first, second] = francAll(text.slice(0, 3000), { minLength: 60 });
  return (
    !first ||
    first[0] === "und" ||
    Boolean(second && first[1] - second[1] < 0.15) ||
    first[0] === iso3[preference]
  );
}

export function networkRegionalAffinity(
  text: string,
  topics: string[],
  region: string,
  language = "en"
): number {
  if (!/^[A-Z]{2}$/u.test(region)) {
    return 0;
  }
  const names = [
    new Intl.DisplayNames([language, "en"], { type: "region" }).of(region),
    new Intl.DisplayNames(["en"], { type: "region" }).of(region),
  ].filter((name): name is string => Boolean(name && name !== region));
  const content = `${text} ${topics.join(" ")}`.normalize("NFKC").toLowerCase();
  return names.some((name) => {
    const escaped = name
      .toLowerCase()
      .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
      "u"
    ).test(content);
  })
    ? 1
    : 0;
}
