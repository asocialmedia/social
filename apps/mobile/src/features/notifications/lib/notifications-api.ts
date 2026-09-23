// Native notification data layer. Mirrors web's notifications client:
// cursor-paged feed (All / Mentions), the unread count, mark-all-read and
// batch dismiss. Pure + injectable like feed-api.ts (cookie, apiBase and
// baseFetch come from the caller), and the row shapes come straight from
// @asm/notifications/shared so grouping and copy match web exactly.

import type {
  GroupedNotification,
  NotificationRecord,
} from "@asm/notifications/shared";
import {
  groupNotifications,
  isNotificationType,
} from "@asm/notifications/shared";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { FeedApiError } from "@/features/feed/lib/feed-api";

export { groupNotifications } from "@asm/notifications/shared";

// The native row narrows createdAt to an ISO string (JSON never carries a
// Date), which lets the presenter and date formatter work without a union.
export type NotificationItem = Omit<NotificationRecord, "createdAt"> & {
  createdAt: string;
};
export type GroupedNotificationItem = GroupedNotification<NotificationItem>;

export type NotificationTab = "all" | "mentions";

export interface NotificationsPage {
  nextCursor: string | null;
  notifications: NotificationItem[];
}

function callNotificationsApi(
  path: string,
  options: ApiCallOptions & { body?: string; method?: string }
): Promise<Response> {
  const baseFetch = options.baseFetch ?? fetch;
  const headers: Record<string, string> = {};
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return baseFetch(`${options.apiBase}${path}`, {
    body: options.body,
    headers,
    method: options.method ?? "GET",
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function normalizeCreatedAt(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

// The server sends the full Prisma row (with issuer/post/community/comment
// includes) over JSON. Dates arrive as ISO strings and `type` as a string;
// this narrows both so a malformed row is dropped instead of crashing a render.
function parseNotification(raw: unknown): NotificationItem | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !isNotificationType(row.type) ||
    typeof row.recipientId !== "string"
  ) {
    return null;
  }
  const { issuer } = row;
  if (typeof issuer !== "object" || issuer === null) {
    return null;
  }
  const issuerRow = issuer as Record<string, unknown>;
  if (typeof issuerRow.id !== "string") {
    return null;
  }

  return {
    comment: parseComment(row.comment),
    commentId: typeof row.commentId === "string" ? row.commentId : null,
    community: parseCommunity(row.community),
    communityId: typeof row.communityId === "string" ? row.communityId : null,
    count: typeof row.count === "number" ? row.count : 1,
    createdAt: normalizeCreatedAt(row.createdAt),
    id: row.id,
    issuer: {
      avatarUrl: stringOrNull(issuerRow.avatarUrl),
      displayName: stringOrNull(issuerRow.displayName),
      id: issuerRow.id,
      username: stringOrNull(issuerRow.username),
    },
    issuerId: typeof row.issuerId === "string" ? row.issuerId : issuerRow.id,
    post: parsePost(row.post),
    postId: typeof row.postId === "string" ? row.postId : null,
    read: Boolean(row.read),
    recipientId: row.recipientId,
    type: row.type,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseComment(raw: unknown): NotificationItem["comment"] {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string") {
    return null;
  }
  const parent =
    typeof row.parent === "object" && row.parent !== null
      ? {
          userId:
            stringOrNull((row.parent as Record<string, unknown>).userId) ?? "",
        }
      : null;
  return {
    id: row.id,
    parent,
    parentId: typeof row.parentId === "string" ? row.parentId : null,
  };
}

function parseCommunity(raw: unknown): NotificationItem["community"] {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.slug !== "string") {
    return null;
  }
  return {
    accentColor: stringOrNull(row.accentColor),
    id: row.id,
    name: typeof row.name === "string" ? row.name : row.slug,
    slug: row.slug,
  };
}

function parsePost(raw: unknown): NotificationItem["post"] {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string") {
    return null;
  }
  const community =
    typeof row.community === "object" && row.community !== null
      ? {
          slug:
            stringOrNull((row.community as Record<string, unknown>).slug) ?? "",
        }
      : null;
  return {
    community,
    content: stringOrNull(row.content),
    id: row.id,
    isGust: Boolean(row.isGust),
    parentPostId: stringOrNull(row.parentPostId),
  };
}

function parseNotificationsPage(payload: unknown): NotificationsPage {
  const page = (payload ?? {}) as {
    nextCursor?: unknown;
    notifications?: unknown;
  };
  const notifications = Array.isArray(page.notifications)
    ? page.notifications
        .map((raw) => parseNotification(raw))
        .filter((item): item is NotificationItem => item !== null)
    : [];
  return {
    nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
    notifications,
  };
}

// One cursor page of notifications, filtered by tab.
export async function fetchNotificationsPage(
  tab: NotificationTab,
  cursor: string | null,
  options: ApiCallOptions
): Promise<NotificationsPage> {
  const params = new URLSearchParams({ type: tab });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await callNotificationsApi(
    `/api/notifications?${params.toString()}`,
    options
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Notifications request failed (${response.status})`,
      response.status
    );
  }
  return parseNotificationsPage(await readJson(response));
}

// Groups the flattened pages exactly as web does.
export function groupFetchedNotifications(
  items: NotificationItem[]
): GroupedNotificationItem[] {
  return groupNotifications(items);
}

export async function fetchUnreadCount(
  options: ApiCallOptions
): Promise<number> {
  const response = await callNotificationsApi(
    "/api/notifications/unread-count",
    options
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Unread count request failed (${response.status})`,
      response.status
    );
  }
  const payload = (await readJson(response)) as {
    unreadCount?: unknown;
  } | null;
  return typeof payload?.unreadCount === "number" ? payload.unreadCount : 0;
}

// Marks every notification read. Idempotent.
export async function markAllNotificationsRead(
  options: ApiCallOptions
): Promise<void> {
  const response = await callNotificationsApi(
    "/api/notifications/mark-as-read",
    {
      ...options,
      method: "PATCH",
    }
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Mark-as-read failed (${response.status})`,
      response.status
    );
  }
}

// Deletes one notification (or a grouped set via comma-separated ids).
export async function dismissNotifications(
  ids: string[],
  options: ApiCallOptions
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const response = await callNotificationsApi(
    `/api/notifications/${ids.map(encodeURIComponent).join(",")}`,
    { ...options, method: "DELETE" }
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Dismiss failed (${response.status})`,
      response.status
    );
  }
}
