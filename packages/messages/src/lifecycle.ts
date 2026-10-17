export const CHAT_DAY_MS = 24 * 60 * 60 * 1000;
export const LIFECYCLE_CAPABILITY = "chat-lifecycle-v1";
export const INCOGNITO_PAGE_SIZE = 50;
export const MAX_INCOGNITO_CIPHERTEXT = 64 * 1024;

export interface IncognitoSession {
  id: string;
  conversationId: string;
  startedById: string | null;
  startedByName: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedById: string | null;
  endedByName: string | null;
  endReason: string | null;
  nextSequence: number;
}

export interface IncognitoMessage {
  id: string;
  sessionId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  keyEpoch: number;
  ratchetIndex: number;
  sequence: number;
  createdAt: string;
}

export interface ChatLifecycleSnapshot {
  serverNow: string;
  retentionSeconds: number;
  retentionVersion: number;
  clearedThroughSequence: number;
  changeSeq: number;
  clearedAt: string | null;
  activeSession: IncognitoSession | null;
  notices: IncognitoSession[];
  nextNoticeCursor: string | null;
}

export function incognitoIsActive(
  session: IncognitoSession,
  now: number
): boolean {
  return session.endedAt === null && Date.parse(session.expiresAt) > now;
}

export function incognitoTimeRemaining(deadline: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  if (!Number.isFinite(seconds) || seconds === 0) {
    return "Ending…";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}h ${minutes}m left`
    : `${minutes}m ${seconds % 60}s left`;
}

export function incognitoNotice(session: IncognitoSession): string {
  if (!session.endedAt) {
    return `${session.startedByName} started an incognito session`;
  }
  return session.endReason === "timeout"
    ? `${session.startedByName} used incognito · Ended automatically after 24 hours`
    : `${session.startedByName} used incognito · Ended by ${session.endedByName ?? "a participant"}`;
}

export async function deriveIncognitoRootKey(
  rootKey: Uint8Array,
  sessionId: string
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(rootKey),
    "HKDF",
    false,
    ["deriveBits"]
  );
  const encoder = new TextEncoder();
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        hash: "SHA-256",
        info: encoder.encode("asocialmedia:incognito:v1"),
        name: "HKDF",
        salt: encoder.encode(sessionId),
      },
      material,
      256
    )
  );
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    )
  );
}

export function validCiphertext(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 24 &&
    value.length <= MAX_INCOGNITO_CIPHERTEXT &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value
    )
  );
}

// Invalid deadlines fail closed; permanent messages have no deadline.
export function messageIsRetained(
  message: { expiresAt?: string | Date | null },
  now = Date.now()
): boolean {
  return !message.expiresAt || new Date(message.expiresAt).getTime() > now;
}

export class ChatDraftStore {
  readonly drafts = new Map<string, string>();
  get(accountId: string, conversationId: string): string {
    return this.drafts.get(JSON.stringify([accountId, conversationId])) ?? "";
  }
  set(accountId: string, conversationId: string, text: string): void {
    const key = JSON.stringify([accountId, conversationId]);
    this.drafts.delete(key);
    if (text) {
      this.drafts.set(key, text.slice(0, 8000));
    }
    while (this.drafts.size > 50) {
      this.drafts.delete(
        requireLifecycleValue(this.drafts.keys().next().value)
      );
    }
  }
}

export function requireLifecycleValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Required chat state is unavailable. Refresh and retry.");
  }
  return value;
}

export async function runChatTask<T>(
  task: () => Promise<T>,
  cleanup: () => void | Promise<void>
): Promise<T> {
  try {
    return await task();
  } finally {
    await cleanup();
  }
}

export function throwChatError(error: unknown): never {
  throw error;
}

export async function observeChatTask<T>(
  promise: Promise<T>,
  success: (value: T) => void,
  failure?: (error: unknown) => void
): Promise<void> {
  try {
    success(await promise);
  } catch (error) {
    failure?.(error);
  }
}

export function canSendIncognitoDraft(
  text: string,
  attachmentCount: number,
  attachmentsReady: boolean
): boolean {
  return attachmentCount > 0 ? attachmentsReady : text.trim().length > 0;
}
