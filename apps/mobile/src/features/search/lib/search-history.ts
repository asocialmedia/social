// Search history parsing, free of React Native and Expo imports so it is
// unit-testable on Node (same convention as the install-token helpers).
//
// The server stores each entry as a JSON string carrying a discriminant, so a
// raw cache row can be either the string or an already-decoded object depending
// on which layer produced it. Both are accepted here, and anything unrecognised
// is dropped rather than rendered as a broken row.

export interface HistoryUser {
  aura?: number;
  avatarUrl?: string | null;
  displayName?: string | null;
  id: string;
  username: string;
}

export interface HistoryPost {
  aura?: number;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
  content: string;
  createdAt: string;
  explicitContent?: boolean;
  id: string;
  previewMedia?: {
    id: string;
    thumbnailKey: string | null;
    type: string;
  } | null;
  viewCount?: number;
}

export type SearchHistoryItem =
  | { resultCount?: number; searchedAt?: number; type: "query"; query: string }
  | { searchedAt?: number; type: "user"; user: HistoryUser }
  | { searchedAt?: number; type: "post"; post: HistoryPost };

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function searchedAtOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseUser(value: unknown): HistoryUser | null {
  const user = objectOf(value);
  const id = textOf(user?.id);
  const username = textOf(user?.username);
  if (!id || !username) {
    return null;
  }
  const result: HistoryUser = {
    avatarUrl: textOf(user?.avatarUrl),
    displayName: textOf(user?.displayName),
    id,
    username,
  };
  if (typeof user?.aura === "number" && Number.isFinite(user.aura)) {
    result.aura = user.aura;
  }
  return result;
}

function parsePost(value: unknown): HistoryPost | null {
  const post = objectOf(value);
  const id = textOf(post?.id);
  const content = textOf(post?.content);
  if (!id || !content) {
    return null;
  }
  const result: HistoryPost = {
    content,
    // A stored post without a usable date still has to render, so it falls back
    // to the epoch rather than producing an invalid Date.
    createdAt: textOf(post?.createdAt) ?? new Date(0).toISOString(),
    id,
  };
  const authorUsername = textOf(post?.authorUsername);
  if (authorUsername !== null) {
    result.authorUsername = authorUsername;
  }
  if (typeof post?.aura === "number" && Number.isFinite(post.aura)) {
    result.aura = post.aura;
  }
  const authorAvatarUrl = textOf(post?.authorAvatarUrl);
  if (authorAvatarUrl !== null) {
    result.authorAvatarUrl = authorAvatarUrl;
  }
  if (post?.explicitContent === true) {
    result.explicitContent = true;
  }
  const preview = objectOf(post?.previewMedia);
  if (preview && typeof preview.id === "string") {
    result.previewMedia = {
      id: preview.id,
      thumbnailKey: textOf(preview.thumbnailKey),
      type: textOf(preview.type) ?? "IMAGE",
    };
  }
  if (typeof post?.viewCount === "number" && Number.isFinite(post.viewCount)) {
    result.viewCount = post.viewCount;
  }

  return result;
}

// Decodes one raw history entry, or null when it cannot be rendered.
export function parseHistoryItem(raw: unknown): SearchHistoryItem | null {
  const source = objectOf(raw) ?? decodeString(raw);
  if (!source) {
    return null;
  }
  const searchedAt = searchedAtOf(source.searchedAt);
  if (source.type === "query") {
    const query = textOf(source.query);
    return query
      ? {
          query,
          resultCount:
            typeof source.resultCount === "number" &&
            Number.isFinite(source.resultCount)
              ? source.resultCount
              : undefined,
          searchedAt,
          type: "query",
        }
      : null;
  }
  if (source.type === "user") {
    const user = parseUser(source.user);
    return user ? { searchedAt, type: "user", user } : null;
  }
  if (source.type === "post") {
    const post = parsePost(source.post);
    return post ? { post, searchedAt, type: "post" } : null;
  }
  return null;
}

function decodeString(raw: unknown): Record<string, unknown> | null {
  const text = textOf(raw);
  if (!text) {
    return null;
  }
  try {
    return objectOf(JSON.parse(text));
  } catch {
    return null;
  }
}

// Parses a whole history page, dropping entries that cannot be rendered.
export function parseSearchHistory(payload: unknown): SearchHistoryItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((entry) => {
    const item = parseHistoryItem(entry);
    return item ? [item] : [];
  });
}

// The opaque key the server matches a removal against. It is the entry's own
// serialized form, so the client has to send back exactly what it received
// rather than reconstructing it.
export function historyItemKey(item: SearchHistoryItem, raw?: unknown): string {
  const text = textOf(raw);
  if (text) {
    return text;
  }
  return JSON.stringify({ searchedAt: item.searchedAt, type: item.type });
}

// The label a history row shows, matching web's row copy.
export function historyItemLabel(item: SearchHistoryItem): string {
  if (item.type === "query") {
    return item.query;
  }
  if (item.type === "user") {
    return item.user.displayName || item.user.username;
  }
  return `@${item.post.authorUsername ?? "someone"}`;
}

// Relative search timestamp matching web's formatSearchTime (lib/utils.ts).
export function formatSearchTime(date?: Date | string | number | null): string {
  if (!date) {
    return "";
  }
  try {
    const dateObj =
      typeof date === "number" || typeof date === "string"
        ? new Date(date)
        : date;
    if (Number.isNaN(dateObj.getTime())) {
      return "";
    }
    const currentDate = new Date();
    const diffMs = currentDate.getTime() - dateObj.getTime();
    if (diffMs < 60 * 1000) {
      return "searched just now";
    }
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < 60) {
      return `searched ${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `searched ${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `searched ${diffDays}d ago`;
    }
    return `searched on ${dateObj.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    })}`;
  } catch {
    return "";
  }
}
