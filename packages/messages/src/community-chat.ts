import type { MessagePayload } from "./payload";

export const COMMUNITY_CHAT_HISTORY_PAGE_LIMIT = 100;
export const COMMUNITY_CHAT_MAX_TEXT_LENGTH = 4000;

export interface CommunityChatPermissions {
  canManage: boolean;
  canRead: boolean;
  canSend: boolean;
  isMember: boolean;
}

export interface CommunityChatMessage {
  changeSequence: string;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
  id: string;
  payload: MessagePayload | null;
  replyToId: string | null;
  revision: number;
  roomId: string;
  sender: {
    avatarUrl: string | null;
    displayName: string;
    id: string;
    username: string;
  };
  senderId: string;
  sequence: string;
}

export interface CommunityChatRoom {
  archived: boolean;
  channelType: "ANNOUNCEMENT" | "TEXT" | null;
  id: string;
  kind: "CHANNEL" | "THREAD";
  locked: boolean;
  name: string;
  nextSequence: string;
  parentRoomId: string | null;
  slug: string;
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
