const EXPLICIT_MEDIA_LABELS = new Set([
  "adult",
  "corpse",
  "gore",
  "graphic-media",
  "nsfw",
  "nudity",
  "porn",
  "pornography",
  "r18",
  "r-18",
  "self-harm",
  "sexual",
  "torture",
  "violence",
  "xxx",
  "furry",
  "yiff",
]);

const EXPLICIT_TAGS = new Set([
  "18+",
  "adult",
  "corpse",
  "ecchi",
  "erotic",
  "gore",
  "graphic-media",
  "hentai",
  "lewd",
  "nsfw",
  "nsfwart",
  "nudity",
  "porn",
  "pornography",
  "r18",
  "r-18",
  "self-harm",
  "sex",
  "sexual",
  "torture",
  "violence",
  "xxx",
  // Furry explicit / adult content tags
  "furry",
  "furryart",
  "furryartist",
  "furryartwork",
  "furryimages",
  "furrydrawing",
  "furrydrawings",
  "digitalfurryart",
  "nsfwfurry",
  "furryporn",
  "yiff",
  "murrsuit",
  "furaffinity",
  "e621",
]);

const EXPLICIT_HASHTAG_REGEX =
  /#(?:18\+|adult|corpse|ecchi|erotic|gore|graphic-media|hentai|lewd|nsfw|nsfwart|nudity|porn|pornography|r18|r-18|self-harm|sexual|torture|violence|xxx|furry|furryart|furryartist|furryimages|furrydrawing|digitalfurryart|nsfwfurry|furryporn|yiff|murrsuit|furaffinity|e621)\b/i;

const EXPLICIT_TEXT_REGEX =
  /\b(?:porn|pornography|xxx|hentai|ecchi|nsfw|nsfwart|yiff|furryporn|nsfwfurry|furry(?:art|artist|artwork)?|murrsuit|e621|furaffinity|underwear|lingerie|nudes?|naked|topless|onlyfans|fansly)\b/i;

export interface BlueskyContentLabels {
  author?: { labels?: readonly string[]; description?: string };
  media?: readonly { alt?: string }[];
  externalLink?: { title?: string; description?: string; url?: string };
  quote?: BlueskyContentLabels;
  facets?: { tags?: readonly string[] };
  labels?: readonly string[];
  selfLabels?: readonly string[];
  tags?: readonly string[];
  text?: string;
}

export function isExplicitTagOrTopic(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^#+/u, "").trim();
  return (
    EXPLICIT_TAGS.has(normalized) ||
    EXPLICIT_MEDIA_LABELS.has(normalized) ||
    normalized.startsWith("furry") ||
    normalized.startsWith("nsfw") ||
    normalized.startsWith("porn") ||
    normalized.startsWith("yiff")
  );
}

// Media-warning labels also apply to posts from an account carrying that label.
// General content warnings and access restrictions are not explicit-media labels.
export function blueskyMediaIsExplicit(post: BlueskyContentLabels): boolean {
  const visited = new Set<BlueskyContentLabels>();
  let current: BlueskyContentLabels | undefined = post;
  while (current) {
    if (visited.has(current)) {
      return true;
    }
    visited.add(current);
    if (
      [current.labels, current.selfLabels, current.author?.labels].some(
        (labels) => labels?.some((label) => isExplicitTagOrTopic(label))
      )
    ) {
      return true;
    }
    if (
      [...(current.tags ?? []), ...(current.facets?.tags ?? [])].some(
        isExplicitTagOrTopic
      )
    ) {
      return true;
    }
    const text = [
      current.text,
      current.author?.description,
      current.externalLink?.title,
      current.externalLink?.description,
      current.externalLink?.url,
      ...(current.media ?? []).map((media) => media.alt),
    ]
      .filter(Boolean)
      .join(" ");
    if (
      EXPLICIT_HASHTAG_REGEX.test(text) ||
      EXPLICIT_TEXT_REGEX.test(text) ||
      /(?:^|[^\p{L}\p{N}])(?:18\s*\+|adults?[- ]only|sexually explicit)(?=$|[^\p{L}\p{N}])/iu.test(
        text
      )
    ) {
      return true;
    }
    current = current.quote;
  }
  return false;
}

export function hasRestrictedDiscoveryLabels(
  post: BlueskyContentLabels
): boolean {
  return [post.labels, post.selfLabels, post.author?.labels].some((labels) =>
    labels?.some((label) =>
      [
        "!hide",
        "!warn",
        "!takedown",
        "!suspend",
        "!no-unauthenticated",
        "spam",
        "scam",
      ].includes(label.toLowerCase())
    )
  );
}

// Re-evaluate labels on older cached presentation rows before their media renders.
export function postHasExplicitMedia(post: {
  content?: string | null;
  explicitContent?: boolean;
  attachments?: readonly { altText?: string | null }[];
  external?: BlueskyContentLabels;
  semanticTags?: readonly string[] | null;
  tags?: readonly { name: string }[];
}): boolean {
  if (post.explicitContent === true) {
    return true;
  }
  if (post.external && blueskyMediaIsExplicit(post.external)) {
    return true;
  }
  const tags = [
    ...(post.tags ?? []).map((t) => t.name),
    ...(post.semanticTags ?? []),
  ];
  if (tags.some((tag) => isExplicitTagOrTopic(tag))) {
    return true;
  }
  if (
    blueskyMediaIsExplicit({
      media: post.attachments?.map((media) => ({
        alt: media.altText ?? undefined,
      })),
      text: post.content ?? undefined,
    })
  ) {
    return true;
  }
  return false;
}
