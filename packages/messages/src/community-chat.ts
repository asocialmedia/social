import type { MessagePayload } from "./payload";

export const COMMUNITY_CHAT_HISTORY_PAGE_LIMIT = 100;
export const COMMUNITY_CHAT_MAX_TEXT_LENGTH = 4000;
export const COMMUNITY_CHAT_HISTORY_BYTE_LIMIT = 1024 * 1024;
export const COMMUNITY_CHAT_TRANSCRIPT_LIMIT = 800;
export const COMMUNITY_CHAT_TRANSCRIPT_BYTE_LIMIT = 8 * 1024 * 1024;

export type CommunityChatRole =
  | "MEMBER"
  | "MODERATOR"
  | "OWNER"
  | "PARTICIPANT";

export interface CommunityChatReaction {
  count: number;
  emoji: string;
  reacted: boolean;
}

export interface CommunityChatReplyReference {
  content: string | null;
  deleted: boolean;
  id: string;
  senderName: string;
}

export interface CommunityChatPermissions {
  canManage: boolean;
  canRead: boolean;
  canSend: boolean;
  isMember: boolean;
  writeRestriction?:
    | "ANNOUNCEMENT"
    | "ARCHIVED"
    | "BANNED"
    | "JOIN"
    | "LOCKED"
    | "PENDING"
    | "TIMEOUT"
    | null;
}

export interface CommunityChatMessage {
  changeSequence: string;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
  id: string;
  payload: MessagePayload | null;
  pinned?: boolean;
  reactions?: CommunityChatReaction[];
  replyTo?: CommunityChatReplyReference | null;
  replyToId: string | null;
  revision: number;
  roomId: string;
  sender: {
    avatarUrl: string | null;
    displayName: string;
    id: string;
    role?: CommunityChatRole | null;
    username: string;
  };
  senderId: string;
  sequence: string;
}

export interface CommunityChatRoom {
  archived: boolean;
  channelType: "ANNOUNCEMENT" | "TEXT" | null;
  changeSequence: string;
  id: string;
  kind: "CHANNEL" | "THREAD";
  locked: boolean;
  name: string;
  nextSequence: string;
  parentRoomId: string | null;
  slug: string;
  slowModeSeconds: number;
  sortOrder: number;
  topic: string | null;
  visibility: "PRIVATE" | "PUBLIC";
}

export interface CommunityChatThreadSummary {
  room: CommunityChatRoom;
  sourceMessage: CommunityChatMessage | null;
}

export interface CommunityChatMemberOption {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  username: string;
}

export interface CommunityChatMemberPage {
  members: CommunityChatMemberOption[];
  nextCursor: string | null;
}

export interface CommunityChatMessagePage {
  messages: CommunityChatMessage[];
  nextBeforeSequence: string | null;
  nextAfterSequence: string | null;
}

export interface CommunityChatChange {
  changeSequence: string;
  kind: string;
  message?: CommunityChatMessage | null;
  messageId?: string | null;
  payload?: unknown;
  roomId: string;
}

export function parseCommunityChatText(value: unknown): MessagePayload {
  if (typeof value !== "string") {
    throw new TypeError("Message text is required");
  }
  const content = value.trim();
  if (content.length === 0 || content.length > COMMUNITY_CHAT_MAX_TEXT_LENGTH) {
    throw new Error("Message text must be between 1 and 4,000 characters");
  }
  return { content, type: "text" };
}
