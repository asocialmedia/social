const MESSAGE_CHANGE_CHANNEL_PREFIX = "asm:message-change:v1:";
const MAX_BROADCAST_MESSAGE_IDS = 1000;

export interface MessageChangeNotice {
  accessChanged: boolean;
  conversationId: string;
  messageIds: string[];
  unavailableMessageIds: string[];
  resetRequired: boolean;
}

export interface MessageChangeBroadcastPort {
  addMessageListener: (listener: (value: unknown) => void) => () => void;
  close: () => void;
  postMessage: (value: unknown) => void;
}

interface MessageChangeBroadcastMessage extends MessageChangeNotice {
  sourceId: string;
  type: "message-change";
  userId: string;
  version: 1;
}

export interface MessageChangeBroadcast {
  close: () => void;
  publish: (notice: MessageChangeNotice) => boolean;
}

function appendValidIds(value: unknown, target: string[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const ids: unknown[] = value;
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || id.length > 512) {
      return false;
    }
    target.push(id);
  }
  return true;
}

function parseMessage(
  value: unknown,
  userId: string,
  sourceId: string
): MessageChangeNotice | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (
    message.type !== "message-change" ||
    message.version !== 1 ||
    message.userId !== userId ||
    typeof message.sourceId !== "string" ||
    message.sourceId.length === 0 ||
    message.sourceId.length > 128 ||
    message.sourceId === sourceId ||
    typeof message.conversationId !== "string" ||
    message.conversationId.length === 0 ||
    message.conversationId.length > 512 ||
    typeof message.resetRequired !== "boolean" ||
    typeof message.accessChanged !== "boolean" ||
    !Array.isArray(message.messageIds) ||
    message.messageIds.length > MAX_BROADCAST_MESSAGE_IDS ||
    !Array.isArray(message.unavailableMessageIds) ||
    message.unavailableMessageIds.length > MAX_BROADCAST_MESSAGE_IDS
  ) {
    return null;
  }
  const messageIds: string[] = [];
  const unavailableMessageIds: string[] = [];
  if (
    !appendValidIds(message.messageIds, messageIds) ||
    !appendValidIds(message.unavailableMessageIds, unavailableMessageIds)
  ) {
    return null;
  }
  return {
    accessChanged: message.accessChanged,
    conversationId: message.conversationId,
    messageIds: [...new Set(messageIds)],
    resetRequired: message.resetRequired || message.accessChanged,
    unavailableMessageIds: [...new Set(unavailableMessageIds)],
  };
}

function defaultCreateChannel(name: string): MessageChangeBroadcastPort | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  try {
    const channel = new BroadcastChannel(name);
    return {
      addMessageListener(listener) {
        const onMessage = (event: MessageEvent<unknown>) => {
          listener(event.data);
        };
        channel.addEventListener("message", onMessage);
        return () => channel.removeEventListener("message", onMessage);
      },
      close: () => channel.close(),
      // BroadcastChannel.postMessage does not accept a targetOrigin argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      postMessage: (value) => channel.postMessage(value),
    };
  } catch {
    return null;
  }
}

export function messageChangeBroadcastChannelName(userId: string): string {
  return `${MESSAGE_CHANGE_CHANNEL_PREFIX}${encodeURIComponent(userId)}`;
}

export function createMessageChangeBroadcast(input: {
  onNotice: (notice: MessageChangeNotice) => void;
  userId: string;
  createChannel?: (name: string) => MessageChangeBroadcastPort | null;
  sourceId?: string;
}): MessageChangeBroadcast {
  const requestedSourceId = input.sourceId ?? crypto.randomUUID();
  const sourceId =
    requestedSourceId.length > 0 && requestedSourceId.length <= 128
      ? requestedSourceId
      : crypto.randomUUID();
  let closed = false;
  let channel: MessageChangeBroadcastPort | null = null;
  let unsubscribe: (() => void) | null = null;
  const onMessage = (value: unknown) => {
    if (closed) {
      return;
    }
    const notice = parseMessage(value, input.userId, sourceId);
    if (!notice) {
      return;
    }
    try {
      input.onNotice(notice);
    } catch {
      // A notification consumer must not break other tabs' message handlers.
    }
  };

  try {
    channel = (input.createChannel ?? defaultCreateChannel)(
      messageChangeBroadcastChannelName(input.userId)
    );
    unsubscribe = channel?.addMessageListener(onMessage) ?? null;
  } catch {
    channel = null;
  }

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (channel) {
        unsubscribe?.();
        channel.close();
      }
      unsubscribe = null;
      channel = null;
    },
    publish(notice) {
      if (
        closed ||
        !channel ||
        !notice.conversationId ||
        notice.conversationId.length > 512
      ) {
        return false;
      }
      const ids = [...new Set(notice.messageIds)];
      const unavailableIds = [...new Set(notice.unavailableMessageIds)];
      const resetRequired =
        notice.resetRequired ||
        notice.accessChanged ||
        ids.length > MAX_BROADCAST_MESSAGE_IDS ||
        unavailableIds.length > MAX_BROADCAST_MESSAGE_IDS ||
        !ids.every((id) => id.length > 0 && id.length <= 512) ||
        !unavailableIds.every((id) => id.length > 0 && id.length <= 512);
      const message: MessageChangeBroadcastMessage = {
        accessChanged: notice.accessChanged,
        conversationId: notice.conversationId,
        messageIds: resetRequired ? [] : ids,
        resetRequired,
        sourceId,
        type: "message-change",
        unavailableMessageIds: resetRequired ? [] : unavailableIds,
        userId: input.userId,
        version: 1,
      };
      try {
        // BroadcastChannel.postMessage does not accept a targetOrigin argument.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        channel.postMessage(message);
        return true;
      } catch {
        return false;
      }
    },
  };
}
