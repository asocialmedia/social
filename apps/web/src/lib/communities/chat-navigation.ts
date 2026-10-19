import type { CommunityChatRoom } from "@asm/messages";

export function isCommunityChatPath(pathname: string): boolean {
  return /^\/a\/[^/]+\/chat(?:\/[^/]+(?:\/threads\/[^/]+)?)?\/?$/u.test(
    pathname
  );
}

export function communityChatLocation(pathname: string, slug: string) {
  const parts = pathname.replace(/\/$/u, "").split("/");
  if (
    parts[1] !== "a" ||
    parts[2] !== slug ||
    parts[3] !== "chat" ||
    !parts[4]
  ) {
    return null;
  }
  if (parts.length === 5) {
    return { channelId: parts[4], threadId: undefined };
  }
  if (parts.length === 7 && parts[5] === "threads" && parts[6]) {
    return { channelId: parts[4], threadId: parts[6] };
  }
  return null;
}

export function navigateCommunityChat(href: string) {
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState(null, "", href);
  }
}

export function communityChatRoomMatchesLocation(
  room: Pick<CommunityChatRoom, "id" | "kind" | "parentRoomId">,
  channelId: string,
  threadId?: string
) {
  if (threadId) {
    return (
      room.kind === "THREAD" &&
      room.id === threadId &&
      room.parentRoomId === channelId
    );
  }
  return room.kind === "CHANNEL" && room.id === channelId;
}
