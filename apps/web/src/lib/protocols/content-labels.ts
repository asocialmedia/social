const EXPLICIT_MEDIA_LABELS = new Set([
  "porn",
  "sexual",
  "graphic-media",
  "nudity",
]);

interface BlueskyContentLabels {
  author?: { labels?: readonly string[] };
  labels?: readonly string[];
  selfLabels?: readonly string[];
}

// Media-warning labels also apply to posts from an account carrying that label.
// General content warnings and access restrictions are not explicit-media labels.
export function blueskyMediaIsExplicit(post: BlueskyContentLabels): boolean {
  return [post.labels, post.selfLabels, post.author?.labels].some((labels) =>
    labels?.some((label) => EXPLICIT_MEDIA_LABELS.has(label))
  );
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
