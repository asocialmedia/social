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
  /\b(?:porn|pornography|xxx|hentai|ecchi|nsfw|nsfwart|yiff|furryporn|nsfwfurry|murrsuit|e621|furaffinity)\b/i;

export interface BlueskyContentLabels {
  author?: { labels?: readonly string[] };
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
  if (
    [post.labels, post.selfLabels, post.author?.labels].some((labels) =>
      labels?.some(
        (label) =>
          EXPLICIT_MEDIA_LABELS.has(label.toLowerCase()) ||
          isExplicitTagOrTopic(label)
      )
    )
  ) {
    return true;
  }
  const tags = [...(post.tags ?? []), ...(post.facets?.tags ?? [])].map((tag) =>
    tag.toLowerCase().replace(/^#+/u, "")
  );
  if (tags.some((tag) => EXPLICIT_TAGS.has(tag) || isExplicitTagOrTopic(tag))) {
    return true;
  }
  if (
    post.text &&
    (EXPLICIT_HASHTAG_REGEX.test(post.text) ||
      EXPLICIT_TEXT_REGEX.test(post.text))
  ) {
    return true;
  }
  return false;
}

// Re-evaluate labels on older cached presentation rows before their media renders.
export function postHasExplicitMedia(post: {
  content?: string | null;
  explicitContent?: boolean;
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
    post.content &&
    (EXPLICIT_HASHTAG_REGEX.test(post.content) ||
      EXPLICIT_TEXT_REGEX.test(post.content))
  ) {
    return true;
  }
  return false;
}
