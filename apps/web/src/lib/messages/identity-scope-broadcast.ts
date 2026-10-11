const IDENTITY_SCOPE_CHANNEL_PREFIX = "asm:message-identity-scope:v1:";

export type IdentityScopePhase = "generation-changed" | "identity-ready";

export interface IdentityScopeNotice {
  phase: IdentityScopePhase;
  recoveryGeneration: number;
}

export interface IdentityScopeBroadcastPort {
  addMessageListener: (listener: (value: unknown) => void) => () => void;
  close: () => void;
  postMessage: (value: unknown) => void;
}

export interface IdentityScopeStoragePort {
  addStorageListener: (
    listener: (event: { key: string | null; newValue: string | null }) => void
  ) => () => void;
  setItem: (key: string, value: string) => void;
}

interface IdentityScopeBroadcastMessage extends IdentityScopeNotice {
  signalId: string;
  sourceId: string;
  type: "identity-scope";
  userId: string;
  version: 1;
}

const MAX_SEEN_SIGNALS = 128;

export interface IdentityScopeBroadcast {
  close: () => void;
  publish: (notice: IdentityScopeNotice) => boolean;
}

function channelName(userId: string): string {
  return `${IDENTITY_SCOPE_CHANNEL_PREFIX}${encodeURIComponent(userId)}`;
}

function defaultCreateChannel(name: string): IdentityScopeBroadcastPort | null {
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

function defaultStoragePort(): IdentityScopeStoragePort | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storage = window.localStorage;
    return {
      addStorageListener(listener) {
        const onStorage = (event: StorageEvent) => listener(event);
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      },
      setItem: (key, value) => storage.setItem(key, value),
    };
  } catch {
    return null;
  }
}

function parseMessage(
  value: unknown,
  userId: string,
  sourceId: string
): IdentityScopeBroadcastMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (
    message.type !== "identity-scope" ||
    message.version !== 1 ||
    message.userId !== userId ||
    message.sourceId === sourceId ||
    typeof message.sourceId !== "string" ||
    message.sourceId.length === 0 ||
    message.sourceId.length > 128 ||
    typeof message.signalId !== "string" ||
    message.signalId.length === 0 ||
    message.signalId.length > 128 ||
    (message.phase !== "generation-changed" &&
      message.phase !== "identity-ready") ||
    typeof message.recoveryGeneration !== "number" ||
    !Number.isSafeInteger(message.recoveryGeneration) ||
    message.recoveryGeneration < 0
  ) {
    return null;
  }
  return {
    phase: message.phase,
    recoveryGeneration: message.recoveryGeneration,
    signalId: message.signalId,
    sourceId: message.sourceId,
    type: "identity-scope",
    userId,
    version: 1,
  };
}

export function identityScopeBroadcastChannelName(userId: string): string {
  return channelName(userId);
}

export function createIdentityScopeBroadcast(input: {
  onNotice: (notice: IdentityScopeNotice) => void;
  userId: string;
  createChannel?: (name: string) => IdentityScopeBroadcastPort | null;
  createStoragePort?: () => IdentityScopeStoragePort | null;
  sourceId?: string;
}): IdentityScopeBroadcast {
  const requestedSourceId = input.sourceId ?? crypto.randomUUID();
  const sourceId =
    requestedSourceId.length > 0 && requestedSourceId.length <= 128
      ? requestedSourceId
      : crypto.randomUUID();
  const name = channelName(input.userId);
  let closed = false;
  let channel: IdentityScopeBroadcastPort | null = null;
  let storage: IdentityScopeStoragePort | null = null;
  let unsubscribeMessage: (() => void) | null = null;
  let unsubscribeStorage: (() => void) | null = null;
  const seenSignalIds = new Set<string>();
  const signalOrder: string[] = [];

  const onMessage = (value: unknown) => {
    if (closed) {
      return;
    }
    let decoded = value;
    if (typeof value === "string") {
      try {
        decoded = JSON.parse(value);
      } catch {
        return;
      }
    }
    const message = parseMessage(decoded, input.userId, sourceId);
    if (!message || seenSignalIds.has(message.signalId)) {
      return;
    }
    seenSignalIds.add(message.signalId);
    signalOrder.push(message.signalId);
    if (signalOrder.length > MAX_SEEN_SIGNALS) {
      const expiredSignalId = signalOrder.shift();
      if (expiredSignalId) {
        seenSignalIds.delete(expiredSignalId);
      }
    }
    try {
      input.onNotice({
        phase: message.phase,
        recoveryGeneration: message.recoveryGeneration,
      });
    } catch {
      // A notification consumer must not break other tabs' identity handlers.
    }
  };

  try {
    channel = (input.createChannel ?? defaultCreateChannel)(name);
    unsubscribeMessage = channel?.addMessageListener(onMessage) ?? null;
  } catch {
    channel = null;
  }
  try {
    storage = (input.createStoragePort ?? defaultStoragePort)();
    unsubscribeStorage =
      storage?.addStorageListener((event) => {
        if (event.key === name && event.newValue !== null) {
          onMessage(event.newValue);
        }
      }) ?? null;
  } catch {
    storage = null;
  }

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribeMessage?.();
      unsubscribeStorage?.();
      channel?.close();
      unsubscribeMessage = null;
      unsubscribeStorage = null;
      channel = null;
      storage = null;
    },
    publish(notice) {
      if (
        closed ||
        !Number.isSafeInteger(notice.recoveryGeneration) ||
        notice.recoveryGeneration < 0 ||
        (notice.phase !== "generation-changed" &&
          notice.phase !== "identity-ready")
      ) {
        return false;
      }
      const message: IdentityScopeBroadcastMessage = {
        ...notice,
        signalId: crypto.randomUUID(),
        sourceId,
        type: "identity-scope",
        userId: input.userId,
        version: 1,
      };
      let delivered = false;
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        channel?.postMessage(message);
        delivered = channel !== null;
      } catch {
        delivered = false;
      }
      try {
        storage?.setItem(name, JSON.stringify(message));
        delivered = storage !== null || delivered;
      } catch {
        delivered = channel !== null || delivered;
      }
      return delivered;
    },
  };
}
