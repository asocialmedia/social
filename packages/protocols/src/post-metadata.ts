import type { ExternalPost } from "./contracts";

function canonicalTopic(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/^#+/u, "");
}

export function externalPostTopics(post: ExternalPost): string[] {
  return [
    ...new Set(
      [...(post.tags ?? []), ...(post.facets?.tags ?? [])]
        .map(canonicalTopic)
        .filter((tag) => tag.length >= 2 && tag.length <= 80)
    ),
  ].slice(0, 40);
}

export function mergeTopicWeights(
  ...maps: (Record<string, number> | undefined)[]
): Record<string, number> {
  const result: Record<string, number> = Object.create(null);
  for (const map of maps) {
    for (const [raw, weight] of Object.entries(map ?? {})) {
      const topic = canonicalTopic(raw);
      if (topic && Number.isFinite(weight)) {
        result[topic] = (result[topic] ?? 0) + weight;
      }
    }
  }
  return result;
}

const topicPatterns = new Map<string, RegExp>();

function topicPattern(topic: string): RegExp {
  const existing = topicPatterns.get(topic);
  if (existing) {
    return existing;
  }
  const escaped = topic.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    "u"
  );
  if (topicPatterns.size >= 512) {
    topicPatterns.delete(topicPatterns.keys().next().value ?? "");
  }
  topicPatterns.set(topic, pattern);
  return pattern;
}

function linkDomains(post: ExternalPost): string[] {
  return [
    ...(post.facets?.links ?? []),
    ...(post.externalLink ? [post.externalLink.url] : []),
  ].flatMap((link) => {
    try {
      return [new URL(link).hostname.replace(/^www\./u, "")];
    } catch {
      return [];
    }
  });
}

// Author-declared topics are stronger than incidental text or descriptive alt text.
// Quotes and author bios do not silently become topics of this post.
export function externalTopicMatch(
  post: ExternalPost,
  rawTopic: string
): number {
  return createExternalTopicMatcher(post)(rawTopic);
}

// Prepare each post once instead of normalizing its text and media for every persona term.
export function createExternalTopicMatcher(
  post: ExternalPost
): (topic: string) => number {
  const tags = new Set(externalPostTopics(post));
  const text = post.text.normalize("NFKC").toLowerCase();
  const linkText =
    `${post.externalLink?.title ?? ""} ${post.externalLink?.description ?? ""}`
      .normalize("NFKC")
      .toLowerCase();
  const altTexts = post.media.map((media) =>
    media.alt.normalize("NFKC").toLowerCase()
  );
  const domains = new Set(linkDomains(post));
  return (rawTopic) => {
    const topic = canonicalTopic(rawTopic);
    if (topic.length < 2 || topic.length > 80) {
      return 0;
    }
    if (tags.has(topic)) {
      return 1;
    }
    const pattern = topicPattern(topic);
    if (pattern.test(text)) {
      return 0.7;
    }
    if (pattern.test(linkText)) {
      return 0.5;
    }
    if (altTexts.some((alt) => pattern.test(alt))) {
      return 0.35;
    }
    return domains.has(topic) ? 0.25 : 0;
  };
}

const regionTerms: Record<string, string[]> = {
  AU: ["australian", "sydney", "melbourne", "brisbane"],
  CA: ["canadian", "toronto", "vancouver", "montreal"],
  GB: ["britain", "british", "london", "scotland", "wales", "nhs"],
  IN: [
    "indian",
    "delhi",
    "mumbai",
    "bengaluru",
    "bangalore",
    "chennai",
    "hyderabad",
    "kolkata",
    "pune",
    "kerala",
    "tamil nadu",
    "ipl",
    "bcci",
  ],
};

function parsedLocale(value: string): Intl.Locale | undefined {
  try {
    return new Intl.Locale(value);
  } catch {
    return undefined;
  }
}

// These are weak content-affinity signals, never an author's country or physical location.
export function externalRegionalRelevance(
  post: ExternalPost,
  locale: string
): number {
  const preference = parsedLocale(locale);
  const region = preference?.region;
  if (!region) {
    return 0;
  }
  const names = new Intl.DisplayNames([preference.language, "en"], {
    type: "region",
  });
  const englishNames = new Intl.DisplayNames(["en"], { type: "region" });
  const topics = [
    ...(regionTerms[region] ?? []),
    names.of(region),
    englishNames.of(region),
  ].filter((term): term is string => Boolean(term && term !== region));
  const content = [
    post.text,
    ...externalPostTopics(post),
    post.externalLink?.title ?? "",
  ]
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  if (topics.some((term) => topicPattern(canonicalTopic(term)).test(content))) {
    return 2;
  }
  return post.languages.some((language) => {
    const declared = parsedLocale(language);
    return (
      declared?.region === region && declared.language === preference.language
    );
  })
    ? 1
    : 0;
}

// ai-generated is an explicit custom declaration, not a standard global AT Protocol label.
// Topic tags, bot labels, and prose about AI are not evidence of AI-generated media.
export function externalAiDeclaration(
  post: Pick<ExternalPost, "labels" | "selfLabels">
): boolean {
  return [...post.labels, ...(post.selfLabels ?? [])].includes("ai-generated");
}
