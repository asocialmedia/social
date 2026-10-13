import type { MessageConversationData } from "./types";

export type ConversationFilter = "ALL" | "DM" | "DEN";
export const CONVERSATION_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "DM", label: "DMs" },
  { key: "DEN", label: "Dens" },
] as const;
export function conversationKind(conversation: MessageConversationData) {
  return conversation.type ?? "DM";
}
export function conversationName(
  conversation: MessageConversationData,
  viewerId: string | null
) {
  const others = conversation.members.filter(
    (member) => member.userId !== viewerId
  );
  if (conversationKind(conversation) === "DM") {
    return (
      others[0]?.user.displayName || others[0]?.user.username || "Conversation"
    );
  }
  if (conversation.name?.trim()) {
    return conversation.name.trim();
  }
  const names = others
    .filter((member) => !member.leftAt)
    .map((member) => member.user.displayName || member.user.username);
  if (names.length === 0) {
    return "Den";
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
export function conversationLeft(
  conversation: MessageConversationData,
  viewerId: string | null
) {
  return (
    conversationKind(conversation) === "DEN" &&
    Boolean(
      conversation.members.find((member) => member.userId === viewerId)?.leftAt
    )
  );
}
export function conversationPreview(
  conversation: MessageConversationData,
  viewerId: string | null,
  senderId: string | null,
  preview: string
) {
  if (conversationLeft(conversation, viewerId)) {
    return "You left this den";
  }
  if (
    conversationKind(conversation) !== "DEN" ||
    !preview ||
    senderId === viewerId
  ) {
    return preview;
  }
  const sender = conversation.members.find(
    (member) => member.userId === senderId
  );
  const name = sender?.user.displayName || sender?.user.username;
  return name ? `${name}: ${preview}` : preview;
}
export function conversationCounts(
  conversations: readonly MessageConversationData[]
) {
  const counts = { ALL: 0, DEN: 0, DM: 0 };
  for (const conversation of conversations) {
    counts.ALL += 1;
    counts[conversationKind(conversation)] += 1;
  }
  return counts;
}
