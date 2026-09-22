// Pure profile-popup helpers: number/date formatting, aura flame styling,
// social links, badge ranking and image URL resolution. No React Native or
// Expo imports, so they are unit-testable on Node (same convention as
// ./install-token.ts and lib/api-base.ts).

export function formatNumber(num: number): string {
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}m`;
  }
  if (abs >= 1000) {
    return `${sign}${trimTrailingZero((abs / 1000).toFixed(1))}k`;
  }
  return `${sign}${abs}`;
}

function trimTrailingZero(value: string): string {
  return value.includes(".") ? value.replace(/\.0$/, "") : value;
}

export interface AuraFlameStyle {
  color: string;
  filled: boolean;
}

// Mirrors web getAuraFlameClass (lib/aura/aura.ts) as concrete colors: hollow
// at zero, filled orange while positive (darkening past 500), pastel red past
// 1k, pastel yellow past 10k, pastel purple when negative.
export function getAuraFlameStyle(aura: number): AuraFlameStyle {
  if (aura < 0) {
    return { color: "#a78bfa", filled: true };
  }
  if (aura === 0) {
    return { color: "#f97316", filled: false };
  }
  if (aura <= 500) {
    return { color: "#f97316", filled: true };
  }
  if (aura <= 1000) {
    return { color: "#ea580c", filled: true };
  }
  if (aura <= 10_000) {
    return { color: "#f87171", filled: true };
  }
  return { color: "#fde047", filled: true };
}

// "September 2026", like web's formatDate(..., "MMMM yyyy"). Empty string for
// garbage input so a bad timestamp never prints "Invalid Date".
export function formatJoinedDate(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return "";
  }
  return new Date(time).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export type SocialLinkKind =
  | "github"
  | "linkedin"
  | "reddit"
  | "twitter"
  | "website";

export interface SocialLink {
  href: string;
  kind: SocialLinkKind;
  label: string;
}

interface SocialSource {
  customDomain?: string | null;
  githubUsername?: string | null;
  linkedinUsername?: string | null;
  redditUsername?: string | null;
  twitterUsername?: string | null;
}

// Same rows and order as web's getSocialLinks in user-profile-popover.tsx.
export function getSocialLinks(user: SocialSource): SocialLink[] {
  const links: SocialLink[] = [];
  if (user.customDomain) {
    const domain = user.customDomain.replace(/^https?:\/\//, "");
    if (domain) {
      links.push({
        href: `https://${domain}`,
        kind: "website",
        label: `Website: ${domain}`,
      });
    }
  }
  if (user.githubUsername) {
    links.push({
      href: `https://github.com/${user.githubUsername}`,
      kind: "github",
      label: `GitHub: ${user.githubUsername}`,
    });
  }
  if (user.linkedinUsername) {
    links.push({
      href: `https://www.linkedin.com/in/${user.linkedinUsername}`,
      kind: "linkedin",
      label: `LinkedIn: ${user.linkedinUsername}`,
    });
  }
  if (user.twitterUsername) {
    links.push({
      href: `https://x.com/${user.twitterUsername}`,
      kind: "twitter",
      label: `Twitter / X: ${user.twitterUsername}`,
    });
  }
  if (user.redditUsername) {
    links.push({
      href: `https://www.reddit.com/user/${user.redditUsername}`,
      kind: "reddit",
      label: `Reddit: ${user.redditUsername}`,
    });
  }
  return links;
}

// Resolves an avatar/banner URL from the profile payload into something
// expo-image can load. Absolute URLs pass through; app-relative paths
// (proxy images AND the /avatars/* defaults, which web serves as static
// assets on the same origin) are rooted at the API base (dev server or
// prod, per getApiBaseUrl). Null when there is nothing to show, so callers
// fall back to their placeholder.
export function resolveProfileImageUrl(
  rawUrl: string | null | undefined,
  apiBase: string
): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${apiBase.replace(/\/+$/, "")}${trimmed}`;
  }
  return null;
}

const SOCIAL_HOSTS: Record<SocialLinkKind, string> = {
  github: "github.com",
  linkedin: "www.linkedin.com",
  reddit: "www.reddit.com",
  twitter: "x.com",
  website: "",
};

// Validates a social href before handing it to Linking.openURL. The hrefs are
// built from stored usernames, so prove the URL is an https link to the
// expected host (website links may be any https host) and reject anything
// else - no javascript: schemes, no credential (`user@host`) tricks, no
// scheme-relative smuggling. Returns the URL or null.
export function safeSocialUrl(link: SocialLink): string | null {
  let parsed: URL;
  try {
    parsed = new URL(link.href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  const expected = SOCIAL_HOSTS[link.kind];
  if (expected && parsed.host.toLowerCase() !== expected) {
    return null;
  }
  return link.href;
}

export type PlatformBadgeType =
  | "author"
  | "dev"
  | "early"
  | "shitposter"
  | "trending";

export type CommunityRoleBadgeType = "MEMBER" | "MODERATOR" | "OWNER";

// Display precedence across both families, mirroring web's BADGE_PRECEDENCE
// (user-badge-utils.ts): author -> owner -> moderator -> dev -> shitposter ->
// member -> early -> trending. Unknown keys sort last.
const BADGE_PRECEDENCE = [
  "author",
  "owner",
  "moderator",
  "dev",
  "shitposter",
  "member",
  "early",
  "trending",
] as const;

export function badgeRank(key: string): number {
  const index = BADGE_PRECEDENCE.indexOf(
    key.toLowerCase() as (typeof BADGE_PRECEDENCE)[number]
  );
  return index === -1 ? BADGE_PRECEDENCE.length : index;
}

const KNOWN_BADGES: ReadonlySet<string> = new Set([
  "author",
  "dev",
  "early",
  "shitposter",
  "trending",
]);

export function normalizeBadge(
  value: string | null | undefined
): PlatformBadgeType | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  return KNOWN_BADGES.has(normalized)
    ? (normalized as PlatformBadgeType)
    : null;
}

export function normalizeBadges(
  values: (string | null | undefined)[] | null | undefined
): PlatformBadgeType[] {
  if (!values) {
    return [];
  }
  const seen = new Set<PlatformBadgeType>();
  for (const value of values) {
    const type = normalizeBadge(value);
    if (type) {
      seen.add(type);
    }
  }
  // Emit in precedence order instead of sorting: .toSorted is ES2023 and
  // missing on the emulator's Hermes build, and .sort gets rewritten back
  // to .toSorted by the repo's auto-fixer, so neither spelling survives.
  // Role keys in the table never match a platform set; unknown values were
  // already dropped by normalizeBadge.
  return BADGE_PRECEDENCE.filter((key): key is PlatformBadgeType =>
    seen.has(key as PlatformBadgeType)
  );
}

export interface CommunityRoleLike {
  community?: {
    accentColor?: string | null;
    avatarUrl?: string | null;
    name?: string | null;
    slug?: string | null;
  } | null;
  role: string;
}

function isBadgedRole(role: string): role is CommunityRoleBadgeType {
  return role === "OWNER" || role === "MODERATOR" || role === "MEMBER";
}

// One entry per distinct community role, owner first. Duplicated rows for the
// same slug collapse.
export function groupCommunityRoles(
  roles: readonly CommunityRoleLike[] | null | undefined
): CommunityRoleBadgeType[] {
  return groupCommunityRoleItems(roles).map((group) => group.role);
}

export interface CommunityRoleGroup {
  communities: {
    accentColor?: string | null;
    avatarUrl?: string | null;
    name?: string | null;
    slug: string;
  }[];
  role: CommunityRoleBadgeType;
}

// Collapses role rows into one entry per distinct role. A person can own
// several communities, so communities are collected per role (deduped by
// slug, like web's groupCommunityRoles).
export function groupCommunityRoleItems(
  roles: readonly CommunityRoleLike[] | null | undefined
): CommunityRoleGroup[] {
  if (!roles) {
    return [];
  }
  const order: CommunityRoleBadgeType[] = ["OWNER", "MODERATOR", "MEMBER"];
  const buckets = new Map<
    CommunityRoleBadgeType,
    CommunityRoleGroup["communities"]
  >();
  for (const entry of roles) {
    if (!isBadgedRole(entry.role) || !entry.community?.slug) {
      continue;
    }
    const bucket = buckets.get(entry.role) ?? [];
    if (!bucket.some((item) => item.slug === entry.community?.slug)) {
      bucket.push({
        accentColor: entry.community.accentColor ?? null,
        avatarUrl: entry.community.avatarUrl ?? null,
        name: entry.community.name ?? null,
        slug: entry.community.slug,
      });
    }
    buckets.set(entry.role, bucket);
  }
  return order
    .filter((role) => buckets.has(role))
    .map((role) => ({
      communities: buckets.get(role) ?? [],
      role,
    }));
}

export type RankedBadge =
  | { kind: "platform"; type: PlatformBadgeType }
  | { kind: "role"; type: CommunityRoleBadgeType };

// One ordered list across both families, ranked by value so community roles
// interleave with platform badges by significance. The rail shows the first
// entry; the rest collapse behind the "+N" chip.
export function rankBadges(
  badge: string | null | undefined,
  badges: (string | null | undefined)[] | null | undefined,
  communityRoles: readonly CommunityRoleLike[] | null | undefined
): RankedBadge[] {
  const ranked: RankedBadge[] = [
    ...normalizeBadges([...(badges ?? []), badge]).map((type): RankedBadge => ({
      kind: "platform",
      type,
    })),
    ...groupCommunityRoles(communityRoles).map((type): RankedBadge => ({
      kind: "role",
      type,
    })),
  ];
  // Emit in precedence-table order instead of sorting (see normalizeBadges
  // for why neither .sort nor .toSorted is usable here). Unknown keys are
  // not in the table, so they trail everything else, matching badgeRank.
  const byKey = new Map<string, RankedBadge>();
  for (const entry of ranked) {
    byKey.set(entry.type.toLowerCase(), entry);
  }
  const ordered: RankedBadge[] = [];
  for (const key of BADGE_PRECEDENCE) {
    const entry = byKey.get(key);
    if (entry) {
      ordered.push(entry);
    }
  }
  for (const entry of ranked) {
    if (badgeRank(entry.type) >= BADGE_PRECEDENCE.length) {
      ordered.push(entry);
    }
  }
  return ordered;
}

// Validates a freestanding content URL before handing it to Linking.openURL:
// https only, no credentials, parseable. Host is unrestricted (bio links go
// anywhere); social buttons use safeSocialUrl's per-network allowlist.
export function safeLinkUrl(href: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  return href;
}

// Host label for a link chip, mirroring web hostLabel (link-badge.tsx).
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

export type BioSegment =
  | { type: "text"; text: string }
  | { type: "url"; url: string }
  | { type: "mention"; username: string }
  | { type: "tag"; tag: string };

export type LinkPlatformIcon =
  | "github"
  | "reddit"
  | "spotify"
  | "x-twitter"
  | "youtube";

export interface LinkPlatform {
  color: string | null;
  icon: LinkPlatformIcon;
}

// Platform mark for a link chip, mirroring web platformFromUrl
// (link-badge.tsx): YouTube, X, Reddit, GitHub and Spotify get their brand
// glyph; everything else falls back to the host-initial tile.
export function getLinkPlatform(url: string): LinkPlatform | null {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return null;
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com"
  ) {
    return { color: "#ff0000", icon: "youtube" };
  }
  if (host === "x.com" || host === "twitter.com") {
    return { color: null, icon: "x-twitter" };
  }
  if (host === "reddit.com" || host.endsWith(".reddit.com")) {
    return { color: "#ff4500", icon: "reddit" };
  }
  if (host === "github.com" || host.endsWith(".github.com")) {
    return { color: null, icon: "github" };
  }
  if (host === "spotify.com" || host.endsWith(".spotify.com")) {
    return { color: "#1DB954", icon: "spotify" };
  }
  return null;
}

// Matches web's segmentation (post-inline-content.tsx): URLs are split out
// first (trailing sentence punctuation stays outside the link), then the
// remaining text is scanned for @mention / #hashtag tokens with the same
// INLINE_TOKEN_PATTERN (inline-meta.ts).
const URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^]+/gu;
const INLINE_TOKEN_PATTERN = /@[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;

function splitInlineTokens(text: string, segments: BioSegment[]): void {
  let cursor = 0;
  for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
    const [token] = match;
    const index = match.index ?? -1;
    if (index < 0 || !token) {
      continue;
    }
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), type: "text" });
    }
    if (token.startsWith("@")) {
      segments.push({ type: "mention", username: token.slice(1) });
    } else {
      segments.push({ tag: token.slice(1), type: "tag" });
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: "text" });
  }
}

export function segmentBioContent(content: string): BioSegment[] {
  const segments: BioSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(URL_PATTERN)) {
    const [raw] = match;
    const index = match.index ?? -1;
    if (index < 0 || !raw) {
      continue;
    }
    if (index > cursor) {
      splitInlineTokens(content.slice(cursor, index), segments);
    }
    const url = raw.replace(TRAILING_PUNCTUATION, "");
    const trailing = raw.slice(url.length);
    if (url) {
      segments.push({ type: "url", url });
    }
    if (trailing) {
      segments.push({ text: trailing, type: "text" });
    }
    cursor = index + raw.length;
  }
  if (cursor < content.length) {
    splitInlineTokens(content.slice(cursor), segments);
  }
  // Fold adjacent text pieces (URL trailing punctuation plus the next gap
  // split separately) so rendering sees one text node per run.
  const merged: BioSegment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (segment.type === "text" && last?.type === "text") {
      last.text += segment.text;
    } else {
      merged.push(segment);
    }
  }
  return merged.filter(
    (segment) => segment.type !== "text" || segment.text.length > 0
  );
}

// Badge copy for the dropdown panel, mirroring web's ACCOUNT_BADGE_META and
// COMMUNITY_BADGE_META (user-badge.tsx).
const PLATFORM_BADGE_META: Record<
  PlatformBadgeType,
  { description: string; title: string }
> = {
  author: {
    description: "Creator of asocialmedia, the one who started it all",
    title: "Author",
  },
  dev: {
    description: "Builds the stuff you're scrolling through",
    title: "Developer",
  },
  early: {
    description: "OG, here before it was cool",
    title: "Early supporter",
  },
  shitposter: {
    description: "A menace to the feed and everyone on it",
    title: "Shitposter",
  },
  trending: {
    description: "Currently on the trending card, held while you are there",
    title: "Trending",
  },
};

const ROLE_BADGE_META: Record<
  CommunityRoleBadgeType,
  { description: string; title: string }
> = {
  MEMBER: {
    description: "Trusted enough to be named a member of a community",
    title: "Member",
  },
  MODERATOR: {
    description: "Keeps a community in order",
    title: "Moderator",
  },
  OWNER: {
    description: "Founded and runs a community",
    title: "Owner",
  },
};

export type BadgePanelItem =
  | {
      description: string;
      kind: "platform";
      title: string;
      type: PlatformBadgeType;
    }
  | {
      communities: CommunityRoleGroup["communities"];
      description: string;
      kind: "role";
      title: string;
      type: CommunityRoleBadgeType;
    };

// Every badge for the dropdown panel in rail order (platform and role
// families interleaved by shared precedence, like web's panel). Emitted in
// precedence-table order instead of sorting: neither .sort nor .toSorted
// survives both Hermes and the repo's auto-fixer (see normalizeBadges).
export function getBadgePanelItems(
  badge: string | null | undefined,
  badges: (string | null | undefined)[] | null | undefined,
  communityRoles: readonly CommunityRoleLike[] | null | undefined
): BadgePanelItem[] {
  const platforms = new Map<string, BadgePanelItem>();
  for (const type of normalizeBadges([...(badges ?? []), badge])) {
    platforms.set(type, {
      ...PLATFORM_BADGE_META[type],
      kind: "platform",
      type,
    });
  }
  const roles = new Map<string, BadgePanelItem>();
  for (const group of groupCommunityRoleItems(communityRoles)) {
    roles.set(group.role.toLowerCase(), {
      ...ROLE_BADGE_META[group.role],
      communities: group.communities,
      kind: "role",
      type: group.role,
    });
  }
  const items: BadgePanelItem[] = [];
  for (const key of BADGE_PRECEDENCE) {
    const item = platforms.get(key) ?? roles.get(key);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

// A resolved link preview for a bio pill. Titles come from the server's
// link-preview endpoint (web's preview-mode label); the pill never hardcodes
// copy for a URL.
export interface BioLinkPreview {
  title: string;
}

export function parseLinkPreview(payload: unknown): BioLinkPreview | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const embed = (payload as { embed?: unknown }).embed ?? payload;
  if (typeof embed !== "object" || embed === null) {
    return null;
  }
  const { title } = embed as { title?: unknown };
  if (typeof title !== "string" || !title.trim()) {
    return null;
  }
  return { title: title.trim() };
}

// Cuts segments to a character budget at segment boundaries so pills never
// split. The first segment is always admitted, even when it alone exceeds
// the budget: otherwise a single long URL would clamp to an empty body.
export function clampBioSegments(
  segments: BioSegment[],
  limit: number
): { clamped: boolean; visible: BioSegment[] } {
  let length = 0;
  const visible: BioSegment[] = [];
  for (const segment of segments) {
    let size = segment.type === "text" ? segment.text.length : 0;
    if (segment.type === "url") {
      size = segment.url.length;
    } else if (segment.type === "mention") {
      size = segment.username.length + 1;
    } else if (segment.type === "tag") {
      size = segment.tag.length + 1;
    }
    if (visible.length > 0 && length + size > limit) {
      break;
    }
    length += size;
    visible.push(segment);
  }
  return { clamped: visible.length < segments.length, visible };
}
