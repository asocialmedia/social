"use client";

import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { readMembershipSeq } from "@/lib/messages/membership-seq";
import type { MessageData } from "@/lib/messages/types";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

interface MessageStreamEvent {
  kind:
    | "message.created"
    | "message.deleted"
    | "message.edited"
    | "conversation.read"
    | "conversation.delivered"
    | "typing.started"
    | "keys.rotated"
    | "den.membership.changed";
  conversationId: string;
  deliveredAt?: string;
  membershipAction?: string;
  // The den's post-increment roster counter. Optional because the server may not
  // have one to give (a dissolve, a deployment that predates the column), and an
  // unreadable value is dropped rather than guessed at, so `undefined` here means
  // "cannot tell" - the client keeps its previous behaviour rather than assuming
  // its roster is current.
  membershipSeq?: number;
  message?: unknown;
  readAt?: string;
  userId?: string;
}

// The set the server validates against, kept in step with `@asm/db`. Duplicated
// for the same reason `parseMessageEvent` is: the browser bundle must not import
// the server-only DB package.
const DEN_MEMBERSHIP_ACTIONS = new Set([
  "created",
  "dissolved",
  "joined",
  "left",
  "member_added",
  "member_removed",
  "owner_transferred",
  "role_changed",
]);

// Kept client-side (mirrors the @asm/db helper) so the browser bundle never
// drags in the server-only DB package.
export function parseMessageEvent(raw: string): MessageStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageStreamEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "message.deleted" &&
      parsed.kind !== "message.edited" &&
      parsed.kind !== "conversation.read" &&
      parsed.kind !== "conversation.delivered" &&
      parsed.kind !== "typing.started" &&
      parsed.kind !== "keys.rotated" &&
      parsed.kind !== "den.membership.changed"
    ) {
      return null;
    }
    if (typeof parsed.conversationId !== "string") {
      return null;
    }
    if (
      (parsed.kind === "message.created" ||
        parsed.kind === "message.deleted" ||
        parsed.kind === "message.edited") &&
      parsed.message === undefined
    ) {
      return null;
    }
    if (parsed.kind === "typing.started" && typeof parsed.userId !== "string") {
      return null;
    }
    if (
      parsed.kind === "conversation.delivered" &&
      (typeof parsed.userId !== "string" ||
        typeof parsed.deliveredAt !== "string")
    ) {
      return null;
    }
    if (
      parsed.kind === "conversation.read" &&
      (typeof parsed.userId !== "string" || typeof parsed.readAt !== "string")
    ) {
      return null;
    }
    if (
      parsed.kind === "den.membership.changed" &&
      (typeof parsed.userId !== "string" ||
        !DEN_MEMBERSHIP_ACTIONS.has(parsed.membershipAction ?? ""))
    ) {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      deliveredAt: parsed.deliveredAt,
      kind: parsed.kind,
      membershipAction: parsed.membershipAction,
      // Dropped rather than forwarded when it is not a non-negative whole number,
      // which is the same lenient reading the server's parser applies: an
      // unreadable counter degrades to "no counter", and never to a crash and
      // never to a receiver treating an old roster as current.
      membershipSeq: readMembershipSeq(parsed.membershipSeq) ?? undefined,
      message: parsed.message,
      readAt: parsed.readAt,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

function reviveDates(_key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

// React Compiler cannot lower `throw` statements inside hook try blocks, so
// the stream status check lives in this module-scoped helper.
function openMessageStream(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new Error(`Message stream returned ${response.status}`);
  }
  return response.body;
}

// Decides whether a (re)connect should trigger a catch-up refetch. Guards
// against the fetch-overwrite race that made the transcript look different on
// every open: an in-flight fetch must never be duplicated.
//
// The recent-data age gate applies ONLY to the initial connection, where the
// mount fetch (or a just-folded SSE event for this same stream) already covers
// the window. The stream has no replay cursor, so a genuine reconnect can have
// missed an arbitrary `message.created`/`message.deleted` during the gap -
// no matter how recently the cache was written - and must always reconcile.
// Reconnect catch-up is therefore independent of `dataUpdatedAt`; the in-flight
// guard is what keeps it from stacking a second GET. Pure so the policy is
// unit-tested independently of the stream.
const CATCH_UP_MIN_AGE_MS = 10_000;

export function shouldCatchUp(params: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isReconnect?: boolean;
  minAgeMs?: number;
  now: number;
}): boolean {
  if (params.isFetching) {
    return false;
  }
  if (params.isReconnect) {
    return true;
  }
  if (params.dataUpdatedAt <= 0) {
    return true;
  }
  return (
    params.now - params.dataUpdatedAt >=
    (params.minAgeMs ?? CATCH_UP_MIN_AGE_MS)
  );
}

// Which query keys a (re)connect has to re-read, as plain `[key, id]` pairs so
// this stays independent of any query client's shape. Pure, and the single
// answer to "what does catching up mean".
//
// The transcript's own age gate is `shouldCatchUp`, unchanged. The conversation
// DETAIL is a second question with a different answer: the stream has no replay
// cursor, so a reconnect may have missed a `den.membership.changed` entirely,
// and the detail is the only place a roster or a wrap row lives. There is no
// cheap staleness test for it (no watermark this tab can compare against before
// the fetch), so the policy is simply "on a reconnect, re-read it".
//
// Gated on `isReconnect` rather than fired on every connect: the first greeting
// is covered by the mount fetch, and re-reading the detail on every mount would
// double the requests a thread opening costs. Gated on nothing else -- the
// in-flight guard inside shouldCatchUp also covers this, because stacking two
// fetches on the same key is the overwrite race it exists to prevent.
export function catchUpKeys(params: {
  conversationId: string;
  dataUpdatedAt: number;
  isFetching: boolean;
  isReconnect: boolean;
  now: number;
}): [string, string][] {
  const transcript: [string, string][] = shouldCatchUp({
    dataUpdatedAt: params.dataUpdatedAt,
    isFetching: params.isFetching,
    isReconnect: params.isReconnect,
    now: params.now,
  })
    ? [["messages", params.conversationId]]
    : [];
  if (!params.isReconnect) {
    return transcript;
  }
  return [...transcript, ["message-conversation", params.conversationId]];
}

// Splits one raw SSE frame ("event: x\ndata: y") into its type and payload.
// Pure so the framing edge cases stay unit-testable without a stream.
export function parseServerSentFrame(rawEvent: string): {
  data: string | null;
  eventType: string;
} {
  let eventType = "message";
  let data: string | null = null;

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }

  return { data, eventType };
}

// The frame name the stream route writes when it re-checks membership and finds
// the caller is no longer inside. Not a published event: it is this one
// connection's server telling this one browser, so it needs no Redis channel and
// no other client can receive it.
export const MEMBERSHIP_ENDED_EVENT = "membership-ended";

// What one complete SSE frame asks the client to do, with no I/O, no React and no
// stream. Pure so the policy is unit-tested directly rather than inferred from a
// running connection, the same reason `shouldCatchUp` exists.
//
// `ignore` covers three genuinely different frames -- a keep-alive comment, an
// event for a conversation this stream is not, and a payload that failed
// validation -- and collapsing them is the point: none of them may throw, and
// none of them may cost a refetch. The third is the one that matters most, since
// a malformed payload arrives from a channel this tab did not write.
export type RealtimeFrameAction =
  | { kind: "connected" }
  | { conversationId: string; kind: "membership-ended" }
  | { event: MessageStreamEvent; kind: "event" }
  | { kind: "ignore" };

export function realtimeFrameAction(
  frame: string,
  conversationId: string
): RealtimeFrameAction {
  const { data, eventType } = parseServerSentFrame(frame);

  // The server greets every (re)connect with `event: connected`. It carries no
  // message data, but it is the signal to refetch and catch up on anything
  // published while the stream was down.
  if (eventType === "connected") {
    return { kind: "connected" };
  }
  if (eventType === MEMBERSHIP_ENDED_EVENT) {
    // The frame names the conversation so a caller holding several hooks can
    // tell which one ended. Falls back to this stream's own id when the payload
    // is unreadable: the frame arrived on this connection, so the answer is the
    // same either way, and dropping it would strand a removed member in a thread
    // that keeps retrying a 404.
    return {
      conversationId: endedConversationId(data, conversationId),
      kind: "membership-ended",
    };
  }
  if (!data || eventType !== "message") {
    return { kind: "ignore" };
  }
  const event = parseMessageEvent(data);
  if (!event || event.conversationId !== conversationId) {
    return { kind: "ignore" };
  }
  return { event, kind: "event" };
}

function endedConversationId(data: string | null, fallback: string): string {
  try {
    const parsed = JSON.parse(data ?? "{}") as { conversationId?: unknown };
    return typeof parsed.conversationId === "string"
      ? parsed.conversationId
      : fallback;
  } catch {
    return fallback;
  }
}

// Returns an `onEvent` callback wired to an SSE connection for a single
// conversation. The caller decides how to fold each event into its query
// cache, so this stays reusable across the thread view and any future UI.
// `onConnect` fires on every (re)connect so the caller can catch up on
// events missed while the stream was down (mobile network drops). It receives
// `isReconnect`, false only for the first greeting of this stream instance, so
// the caller can tell the initial connect (already covered by the mount fetch)
// apart from a real reconnect that may have missed events.
// `onMembershipEnded` fires when the server closed this connection because the
// caller is no longer a member. It is terminal: the reconnect ladder stops, so
// the tab does not spin against a 404 that will never become a 200. It receives
// the conversation the stream was for, so one caller can serve several threads.
export function useMessagesRealtime(
  conversationId: string,
  onEvent: (event: {
    conversationId: string;
    kind: MessageStreamEvent["kind"];
    deliveredAt?: string;
    membershipAction?: string;
    membershipSeq?: number;
    message?: MessageData;
    readAt?: string;
    userId?: string;
  }) => void,
  enabled = true,
  onConnect?: (isReconnect: boolean) => void,
  onMembershipEnded?: (conversationId: string) => void
): { connected: boolean } {
  const { user } = useSession();
  // A stable id keeps the stream effect from tearing down and reconnecting
  // whenever the user object identity changes.
  const userId = user?.id;

  // Keep the latest handlers without reconnecting on every render; the SSE
  // effect below only depends on auth state, the convo id, and enabled.
  const onEventRef = useRef(onEvent);
  const onConnectRef = useRef(onConnect);
  const onMembershipEndedRef = useRef(onMembershipEnded);
  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectRef.current = onConnect;
    onMembershipEndedRef.current = onMembershipEnded;
  }, [onEvent, onConnect, onMembershipEnded]);

  useEffect(() => {
    if (!enabled || !userId || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = INITIAL_RETRY_MS;
    // First greeting of this stream instance (per conversation + effect run);
    // every later one is a reconnect that may have a delivery gap.
    let hasConnected = false;
    // Set once the server has said this member is out. Retrying is pointless
    // (the endpoint will only ever 404) and, worse, keeps a tab reconnecting to
    // a thread it no longer has any business holding open.
    let accessEnded = false;

    const handleRawEvent = (rawEvent: string) => {
      const action = realtimeFrameAction(rawEvent, conversationId);

      if (action.kind === "ignore") {
        return;
      }
      if (action.kind === "connected") {
        retryDelay = INITIAL_RETRY_MS;
        const isReconnect = hasConnected;
        hasConnected = true;
        onConnectRef.current?.(isReconnect);
        return;
      }
      if (action.kind === "membership-ended") {
        accessEnded = true;
        onMembershipEndedRef.current?.(action.conversationId);
        return;
      }

      const { event } = action;
      const message = event.message
        ? (JSON.parse(
            JSON.stringify(event.message),
            reviveDates
          ) as MessageData)
        : undefined;

      onEventRef.current({
        conversationId: event.conversationId,
        deliveredAt: event.deliveredAt,
        kind: event.kind,
        membershipAction: event.membershipAction,
        membershipSeq: event.membershipSeq,
        message,
        readAt: event.readAt,
        userId: event.userId,
      });
      // No invalidation here: the caller folds creates/deletes straight into
      // the query cache, so a refetch per event would just churn the list
      // (and reset decrypt state). Catch-up after a disconnect happens via
      // onConnect instead.
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/messages/conversations/${conversationId}/stream`,
          {
            credentials: "same-origin",
            signal: controller.signal,
          }
        );

        // No delay reset here: the backoff must survive failed attempts, so it
        // resets on the server's `connected` greeting instead (see below). A
        // rate-limited stream endpoint rejects instantly, and resetting here
        // would pin every retry at one second forever -- each attempt spending
        // shared rate-limit budget to keep the limiter tripped.
        const reader = openMessageStream(response).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- stream chunks are sequential
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleRawEvent(rawEvent);
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        // "Error in input stream" is Chrome's generic message when the fetch
        // stream is reset under us (a dev-server recompile, a proxy timeout,
        // or a network blip). The backoff reconnect below recovers from it, so
        // don't treat it as a real failure.
        if (!isBenignStreamError(error)) {
          console.error("Message stream disconnected:", error);
        }
      }

      if (!cancelled && !accessEnded) {
        retryTimer = setTimeout(() => {
          void connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [conversationId, enabled, userId]);

  return { connected: enabled && Boolean(user) };
}

function isBenignStreamError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes("input stream");
}

export type { MessageStreamEvent };
