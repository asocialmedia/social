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
]);

const EXPLICIT_TAGS = new Set([
  "18+",
  "adult",
  "ecchi",
  "erotic",
  "gore",
  "hentai",
  "lewd",
  "nsfw",
  "nsfwart",
  "porn",
  "pornography",
  "r18",
  "r-18",
  "sex",
  "sexual",
  "xxx",
]);

const EXPLICIT_HASHTAG_REGEX =
  /#(?:18\+|adult|ecchi|erotic|gore|hentai|lewd|nsfw|porn|r18|r-18|xxx)\b/i;

export interface BlueskyContentLabels {
  author?: { labels?: readonly string[] };
  facets?: { tags?: readonly string[] };
  labels?: readonly string[];
  selfLabels?: readonly string[];
  tags?: readonly string[];
  text?: string;
}

// Media-warning labels also apply to posts from an account carrying that label.
// General content warnings and access restrictions are not explicit-media labels.
export function blueskyMediaIsExplicit(post: BlueskyContentLabels): boolean {
  if (
    [post.labels, post.selfLabels, post.author?.labels].some((labels) =>
      labels?.some((label) => EXPLICIT_MEDIA_LABELS.has(label.toLowerCase()))
    )
  ) {
    return true;
  }
  const tags = [...(post.tags ?? []), ...(post.facets?.tags ?? [])].map((tag) =>
    tag.toLowerCase().replace(/^#+/u, "")
  );
  if (tags.some((tag) => EXPLICIT_TAGS.has(tag))) {
    return true;
  }
  if (post.text && EXPLICIT_HASHTAG_REGEX.test(post.text)) {
    return true;
  }
  return false;
}

// Re-evaluate labels on older cached presentation rows before their media renders.
export function postHasExplicitMedia(post: {
  explicitContent?: boolean;
  external?: BlueskyContentLabels;
}): boolean {
  return (
    post.explicitContent === true ||
    Boolean(post.external && blueskyMediaIsExplicit(post.external))
  );
}
