import type { ExternalPost } from "@asm/protocols/contracts";
import { francAll } from "franc-min";

const languageCodes: Record<string, string> = {
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
  pl: "pol",
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

export function matchesDiscoveryLanguage(post: ExternalPost, locale: string) {
  if (!locale || locale === "all") {
    return true;
  }
  const language = locale.split("-")[0]?.toLowerCase() ?? "en";
  if (post.languages.length) {
    return post.languages.some(
      (tag) => tag.toLowerCase().split("-")[0] === language
    );
  }
  const text = post.text.replaceAll(/https?:\/\/\S+|@[\w.-]+/g, " ").trim();
  if (text.replaceAll(/[^\p{L}]/gu, "").length < 35) {
    return true;
  }
  const [first, second] = francAll(text, { minLength: 35 });
  if (!first || first[0] === "und" || (second && first[1] - second[1] < 0.1)) {
    return true;
  }
  return !languageCodes[language] || first[0] === languageCodes[language];
}

const regionTerms: Record<string, RegExp> = {
  AU: /\b(?:australia|australian|sydney|melbourne|brisbane)\b/i,
  CA: /\b(?:canada|canadian|toronto|vancouver|montreal)\b/i,
  GB: /\b(?:britain|british|united kingdom|london|scotland|wales|nhs)\b/i,
  IN: /\b(?:india|indian|delhi|mumbai|bengaluru|bangalore|chennai|hyderabad|kolkata|pune|kerala|tamil nadu|ipl|bcci|rupees)\b/i,
};

export function regionalRelevance(post: ExternalPost, locale: string) {
  const [, region] = locale.split("-");
  if (!region) {
    return 0;
  }
  if (
    post.languages.some((tag) => tag.toLowerCase() === locale.toLowerCase())
  ) {
    return 2;
  }
  return regionTerms[region]?.test(
    `${post.text} ${post.author.description ?? ""}`
  )
    ? 1
    : 0;
}
