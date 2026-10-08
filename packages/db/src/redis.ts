import { createHash } from "node:crypto";

import IoRedis from "ioredis";
import type { RedisOptions } from "ioredis";
import type { JSONWebKeySet } from "jose";

import { keys } from "../keys";
import { createRedisConnectionOptions } from "./redis-options";

const createRedisConfig = (): RedisOptions => {
  const config: RedisOptions = {
    autoResendUnfulfilledCommands: true,
    commandTimeout: 3000,
    connectTimeout: 5000,
    enableReadyCheck: true,
    keepAlive: 10_000,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    reconnectOnError: (err) => {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 1000);
      return delay;
    },
    showFriendlyErrorStack: true,
  };

  return config;
};

let redisClient: IoRedis | null = null;

const getRedisClient = (): IoRedis => {
  if (redisClient && redisClient.status !== "end") {
    return redisClient;
  }

  if (redisClient?.status === "end") {
    redisClient = null;
  }

  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  redisClient = new IoRedis(
    createRedisConnectionOptions(redisUrl, createRedisConfig())
  );

  return redisClient;
};

// Direct access to the shared client for consumers that need to hand the
// connection itself to another module (e.g. the auth service's security
// store). Most code should use the `redis` proxy above instead.
export { getRedisClient };

const redis = new Proxy({} as IoRedis, {
  get(_target, property) {
    const client = getRedisClient();
    const value = Reflect.get(client, property, client);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

export { redis };

// A dedicated ioredis connection for blocking commands (XREADGROUP with BLOCK,
// XADD waiting, etc.). The shared client sets a commandTimeout, which would
// kill long-blocking reads; this connection disables it so a BLOCK 2000 read
// can wait as long as the stream stays idle.
let blockingClient: IoRedis | null = null;

export function getBlockingRedisClient(): IoRedis {
  if (blockingClient && blockingClient.status !== "end") {
    return blockingClient;
  }

  if (blockingClient?.status === "end") {
    blockingClient = null;
  }

  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  blockingClient = new IoRedis(
    createRedisConnectionOptions(redisUrl, {
      ...createRedisConfig(),
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
  );

  return blockingClient;
}

// A long-lived pub/sub connection for SSE fan-out. Like the blocking client,
// it drops the commandTimeout and maxRetriesPerRequest so a subscriber that
// sits idle (or reconnects mid-subscription) is never killed by a timeout.
// Created lazily per stream and `quit()` when the stream closes.
export function createSubscriberConnection(): IoRedis {
  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  return new IoRedis(
    createRedisConnectionOptions(redisUrl, {
      ...createRedisConfig(),
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
  );
}

// ---- shared pub/sub hub ----------------------------------------------------
// One long-lived subscriber connection is shared by every SSE stream in the
// process instead of a separate connection per open stream (which, with many
// viewers, burns a Redis connection and its file descriptor each). Streams
// subscribe to a channel and get back an unsubscribe function; the hub
// reference-counts channels so a channel is only unsubscribed (and its slots
// freed) when the last stream leaves it. ioredis re-subscribes automatically
// across reconnects, so only the in-memory listener map needs managing here.
export type ChannelListener = (channel: string, message: string) => void;

export interface ChannelSubscription {
  unsubscribe: () => Promise<void>;
}

let hubClient: IoRedis | null = null;
const hubListeners = new Map<string, Set<ChannelListener>>();
let hubOpenStreams = 0;

// Gauges for observability: how many streams are open and how many distinct
// channels/listeners the shared connection is carrying right now.
export function getSubscriberGauges(): {
  activeChannels: number;
  activeListeners: number;
  openStreams: number;
} {
  let activeListeners = 0;
  for (const listeners of hubListeners.values()) {
    activeListeners += listeners.size;
  }
  return {
    activeChannels: hubListeners.size,
    activeListeners,
    openStreams: hubOpenStreams,
  };
}

// A quiet periodic log of the hub gauges so connection usage is observable in
// the web app's logs without a dedicated metrics endpoint. Only logs while
// streams are actually open; goes silent when the last stream closes.
let gaugeTimer: ReturnType<typeof setInterval> | null = null;

function ensureGaugeLogging(): void {
  if (gaugeTimer) {
    return;
  }
  gaugeTimer = setInterval(() => {
    const gauges = getSubscriberGauges();
    if (gauges.openStreams > 0) {
      console.log(
        `[pubsub-hub] openStreams=${gauges.openStreams} ` +
          `activeChannels=${gauges.activeChannels} ` +
          `activeListeners=${gauges.activeListeners}`
      );
    }
  }, 60_000);
}

function stopGaugeLoggingWhenIdle(): void {
  if (gaugeTimer && hubOpenStreams === 0 && hubListeners.size === 0) {
    clearInterval(gaugeTimer);
    gaugeTimer = null;
  }
}

function getHubClient(): IoRedis {
  if (!hubClient || hubClient.status === "end") {
    if (hubClient?.status === "end") {
      hubClient = null;
    }
    hubClient = createSubscriberConnection();
    hubClient.on("message", (channel, message) => {
      const listeners = hubListeners.get(channel);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        try {
          listener(channel, message);
        } catch (error) {
          console.error("Subscriber listener threw:", error);
        }
      }
    });
    // A fresh connection starts subscribed to nothing. Any channels still in
    // hubListeners belong to streams that outlived the old client (a hard
    // "end", not a reconnect ioredis handles itself), so restore them or those
    // streams would silently go deaf. Brand-new channels are subscribed by
    // subscribeToChannel right after this.
    void restoreHubSubscriptions(hubClient);
  }
  return hubClient;
}

// Re-establishes every channel that still has listeners on a freshly created
// shared subscriber connection. A channel whose last listener left while this
// runs is skipped rather than left as a phantom subscription.
async function restoreHubSubscriptions(client: IoRedis): Promise<void> {
  const channels = [...hubListeners.keys()];
  await Promise.all(
    channels.map(async (channel) => {
      if (!hubListeners.has(channel)) {
        return;
      }
      try {
        await client.subscribe(channel);
      } catch (error) {
        console.error(
          `Failed to restore channel subscription ${channel}:`,
          error
        );
      }
    })
  );
}

// Subscribes `listener` to `channel`. The first stream on a channel triggers
// the real Redis SUBSCRIBE; subsequent streams on the same channel reuse it.
export async function subscribeToChannel(
  channel: string,
  listener: ChannelListener
): Promise<ChannelSubscription> {
  const client = getHubClient();
  const listeners = hubListeners.get(channel) ?? new Set<ChannelListener>();
  const isFirst = listeners.size === 0;
  listeners.add(listener);
  hubListeners.set(channel, listeners);
  hubOpenStreams += 1;
  ensureGaugeLogging();

  if (isFirst) {
    try {
      await client.subscribe(channel);
    } catch (error) {
      // Roll back so a failed subscribe does not strand a phantom listener.
      listeners.delete(listener);
      if (listeners.size === 0) {
        hubListeners.delete(channel);
      }
      hubOpenStreams -= 1;
      throw error;
    }
  }

  let unsubscribed = false;
  return {
    unsubscribe: async () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      hubOpenStreams -= 1;
      const current = hubListeners.get(channel);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        hubListeners.delete(channel);
        try {
          await client.unsubscribe(channel);
        } catch {
          // Non-fatal: the connection may be gone, and ioredis re-syncs
          // subscriptions on reconnect anyway.
        }
      }
      stopGaugeLoggingWhenIdle();
    },
  };
}

export interface TrendingTopic {
  count: number;
  hashtag: string;
}

const TRENDING_TOPICS_KEY = "trending:topics";
const TRENDING_TOPICS_BACKUP_KEY = "trending:topics:backup";
const CACHE_TTL = 3600;
const BACKUP_TTL = 86_400;

export const trendingTopicsCache = {
  async get(): Promise<TrendingTopic[]> {
    try {
      const topics = await redis.get(TRENDING_TOPICS_KEY);
      return topics ? JSON.parse(topics) : [];
    } catch (error) {
      console.error("Error getting trending topics from cache:", error);
      return this.getBackup();
    }
  },

  async getBackup(): Promise<TrendingTopic[]> {
    try {
      const backupTopics = await redis.get(TRENDING_TOPICS_BACKUP_KEY);
      return backupTopics ? JSON.parse(backupTopics) : [];
    } catch (error) {
      console.error("Error getting trending topics from backup cache:", error);
      return [];
    }
  },

  async invalidate(): Promise<void> {
    try {
      const pipeline = redis.pipeline();
      pipeline.del(TRENDING_TOPICS_KEY);
      pipeline.del(`${TRENDING_TOPICS_KEY}:last_updated`);
      await pipeline.exec();
      console.log("Invalidated trending topics cache");
    } catch (error) {
      console.error("Error invalidating trending topics cache:", error);
    }
  },

  refreshCache: null as unknown as () => Promise<TrendingTopic[]>,

  async set(topics: TrendingTopic[]): Promise<void> {
    try {
      const pipeline = redis.pipeline();

      pipeline.set(
        TRENDING_TOPICS_KEY,
        JSON.stringify(topics),
        "EX",
        CACHE_TTL
      );

      pipeline.set(
        TRENDING_TOPICS_BACKUP_KEY,
        JSON.stringify(topics),
        "EX",
        BACKUP_TTL
      );

      pipeline.set(
        `${TRENDING_TOPICS_KEY}:last_updated`,
        Date.now(),
        "EX",
        CACHE_TTL
      );

      await pipeline.exec();
    } catch (error) {
      console.error("Error setting trending topics cache:", error);
    }
  },

  async shouldRefresh(): Promise<boolean> {
    try {
      const lastUpdated = await redis.get(
        `${TRENDING_TOPICS_KEY}:last_updated`
      );
      if (!lastUpdated) {
        return true;
      }
      const timeSinceUpdate = Date.now() - Math.trunc(Number(lastUpdated));
      return timeSinceUpdate > (CACHE_TTL * 1000) / 2;
    } catch {
      return true;
    }
  },

  async warmCache(): Promise<void> {
    try {
      const shouldWarm = await this.shouldRefresh();
      if (!shouldWarm) {
        return;
      }
      await this.refreshCache();
    } catch (error) {
      console.error("Error warming trending topics cache:", error);
    }
  },
};

export const POST_VIEWS_KEY_PREFIX = "post:views:";
export const POST_VIEWS_SET = "posts:with:views";
export const JWKS_CACHE_KEY = "jwks:cache";
export const SESSION_CACHE_KEY_PREFIX = "session:cache:";
export const JWKS_CACHE_TTL = 3600;
export const SESSION_CACHE_TTL = 300;

// Real-time eddies: new comments and comment deletions are published to a
// per-post Redis channel and fanned out to open SSE streams. Pub/sub is used
// instead of a list/stream so the fan-out happens in Redis and every web
// instance (not just the one that handled the write) sees the event.
export const COMMENT_CHANNEL_PREFIX = "comments:";
export const commentChannel = (postId: string): string =>
  `${COMMENT_CHANNEL_PREFIX}${postId}`;

export interface CommentStreamEvent {
  kind: "comment.created" | "comment.deleted";
  postId: string;
  comment: unknown;
}

export function serializeCommentEvent(event: CommentStreamEvent): string {
  return JSON.stringify(event);
}

export function parseCommentEvent(raw: string): CommentStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CommentStreamEvent>;
    if (
      parsed.kind !== "comment.created" &&
      parsed.kind !== "comment.deleted"
    ) {
      return null;
    }
    if (typeof parsed.postId !== "string" || parsed.comment === undefined) {
      return null;
    }
    return {
      comment: parsed.comment,
      kind: parsed.kind,
      postId: parsed.postId,
    };
  } catch {
    return null;
  }
}

export async function publishCommentEvent(
  event: CommentStreamEvent
): Promise<void> {
  try {
    await redis.publish(
      commentChannel(event.postId),
      serializeCommentEvent(event)
    );
  } catch (error) {
    console.error("Error publishing comment event:", error);
  }
}

export async function publishCommentCreated(
  postId: string,
  comment: unknown
): Promise<void> {
  await publishCommentEvent({ comment, kind: "comment.created", postId });
}

export async function publishCommentDeleted(
  postId: string,
  comment: unknown
): Promise<void> {
  await publishCommentEvent({ comment, kind: "comment.deleted", postId });
}

// Real-time responses: post-to-post replies are published to a per-post Redis
// channel (keyed by the post whose DIRECT responses changed) and fanned out to
// open SSE streams, mirroring the eddies stack above.
export const RESPONSE_CHANNEL_PREFIX = "responses:";
export const responseChannel = (postId: string): string =>
  `${RESPONSE_CHANNEL_PREFIX}${postId}`;

export interface ResponseStreamEvent {
  kind: "response.created" | "response.deleted";
  postId: string;
  response: unknown;
}

export function serializeResponseEvent(event: ResponseStreamEvent): string {
  return JSON.stringify(event);
}

export function parseResponseEvent(raw: string): ResponseStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ResponseStreamEvent>;
    if (
      parsed.kind !== "response.created" &&
      parsed.kind !== "response.deleted"
    ) {
      return null;
    }
    if (typeof parsed.postId !== "string" || parsed.response === undefined) {
      return null;
    }
    return {
      kind: parsed.kind,
      postId: parsed.postId,
      response: parsed.response,
    };
  } catch {
    return null;
  }
}

export async function publishResponseEvent(
  event: ResponseStreamEvent
): Promise<void> {
  try {
    await redis.publish(
      responseChannel(event.postId),
      serializeResponseEvent(event)
    );
  } catch (error) {
    console.error("Error publishing response event:", error);
  }
}

export async function publishResponseCreated(
  postId: string,
  response: unknown
): Promise<void> {
  await publishResponseEvent({ kind: "response.created", postId, response });
}

export async function publishResponseDeleted(
  postId: string,
  response: unknown
): Promise<void> {
  await publishResponseEvent({ kind: "response.deleted", postId, response });
}

// ---- messages --------------------------------------------------------------
// Real-time DMs: message writes are published to a per-conversation Redis
// channel and fanned out to open SSE streams, mirroring the comments stack.
// Ciphertext is safe to broadcast; the plaintext never leaves the client.
export const MESSAGE_CHANNEL_PREFIX = "messages:";
export const messageChannel = (conversationId: string): string =>
  `${MESSAGE_CHANNEL_PREFIX}${conversationId}`;

export interface MessageStreamEvent {
  kind:
    | "message.created"
    | "message.deleted"
    // The sender rewrote an existing message's ciphertext in place (same
    // ratchet index, fresh IV). Carries the updated row so an open thread can
    // patch its cache and re-decrypt just that message instead of refetching.
    | "message.edited"
    | "conversation.created"
    | "conversation.read"
    // A member confirmed receipt (not necessarily read) of messages up to a
    // watermark. Carries the acker's id and the new watermark; a sender uses it
    // to flip its own bubbles to Delivered live. No plaintext, safe to broadcast.
    | "conversation.delivered"
    | "typing.started"
    // A member posted new wrapped root keys (a first send in a new
    // conversation, a heal, or an identity reset that rotated the epoch). The
    // payload is deliberately empty: the only correct response is to refetch
    // the conversation detail, because the wraps and/or the peer's identity
    // public key may have changed and a stale copy silently fails every
    // decrypt. Carries no key material, so it is safe to broadcast.
    | "conversation.appearance.changed"
    | "keys.rotated"
    // A den's roster moved: created, somebody joined or left, somebody was
    // added or removed, a role changed, ownership transferred, or the den was
    // dissolved. Same reasoning as `keys.rotated` and for a stronger reason --
    // the roster is an input to "may this epoch still be written into", so a
    // stale snapshot does not merely fail to decrypt, it hands a message to the
    // member who was just removed. Carries ids and a coarse discriminator only,
    // never a body, a key, a ciphertext or an invite code.
    | "den.membership.changed";
  conversationId: string;
  message?: unknown;
  conversation?: unknown;
  userId?: string;
  // ISO timestamp of the newest message a member has acked as delivered. Present
  // only on `conversation.delivered`.
  deliveredAt?: string;
  // ISO timestamp at which a member read the conversation. Present only on
  // `conversation.read`, so the sender patches its read watermark in place
  // instead of refetching the conversation detail.
  readAt?: string;
  // Which way a den's roster moved. Present only on `den.membership.changed`.
  // Deliberately coarse: it is a discriminator, not a description. No target id
  // rides along, so a connection cannot learn anything about the roster from the
  // payload and has to ask the database (or refetch the detail) to learn whether
  // it still belongs.
  membershipAction?: DenMembershipAction;
  // The den's post-increment `membershipSeq`, on `den.membership.changed` only.
  // Present so a receiver can ignore a duplicate delivery and notice one it never
  // got; a client that sees a value two ahead of the last one it applied knows at
  // least one announcement was dropped, which the closed set of channels and a
  // timestamp cannot tell it.
  //
  // Optional by design. Absent on every event a pre-sequence server publishes and
  // on a dissolve, where the row the counter lived on is gone. A receiver treats
  // an absent value as the behaviour it had before this field existed, never as
  // "assume fresh" and never as a reason to drop the event.
  membershipSeq?: number;
}

// What moved in a den. One value per code path that can change a roster, so the
// "publishes exactly once, with the right discriminator" property is testable,
// and so a receiver has one thing to switch on rather than a set of overlapping
// flags. The discriminator carries no identity beyond `userId` (the actor): who
// was added, removed or promoted is deliberately not on the wire.
export const DEN_MEMBERSHIP_ACTIONS = [
  "created",
  "dissolved",
  "joined",
  "left",
  "member_added",
  "member_removed",
  "owner_transferred",
  "role_changed",
] as const;

export type DenMembershipAction = (typeof DEN_MEMBERSHIP_ACTIONS)[number];

// What publishDenMembershipChanged needs: which den, what moved, who did it, and
// whose conversation LIST has to be told. `memberIds` is the roster after the
// mutation and is allowed to be empty (a den that was just dissolved).
export interface DenMembershipEvent {
  action: DenMembershipAction;
  actorId: string;
  conversationId: string;
  memberIds: string[];
  // The post-increment roster counter, when there is one to report. A dissolve
  // has none: the row is gone by the time this publishes.
  membershipSeq?: number;
}

// A roster counter as it arrives on the wire. Narrowed rather than asserted,
// because the value came from JSON and a hostile or broken publisher can put
// anything there. Anything that is not a non-negative whole number is reported as
// absent, which is the same as an event from a server that predates the field -
// and is the safe direction, since the receiver's fallback is today's behaviour
// and never "assume fresh".
//
// Written out rather than shared with the browser's copy of this rule for the same
// reason `parseMessageEvent` is written out twice: the browser bundle must not
// import the server-only DB package, so the two are kept in step by these tests
// rather than by a shared module.
function readMembershipSeq(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    // A counter is a count of one mutation at a time; a value that could not be
    // reached in a lifetime is a corrupt payload, not a real one.
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

function isDenMembershipAction(value: unknown): value is DenMembershipAction {
  return (
    typeof value === "string" &&
    DEN_MEMBERSHIP_ACTIONS.some((action) => action === value)
  );
}

export function serializeMessageEvent(event: MessageStreamEvent): string {
  return JSON.stringify(event);
}

export function parseMessageEvent(raw: string): MessageStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageStreamEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "message.deleted" &&
      parsed.kind !== "message.edited" &&
      parsed.kind !== "conversation.created" &&
      parsed.kind !== "conversation.read" &&
      parsed.kind !== "conversation.delivered" &&
      parsed.kind !== "typing.started" &&
      parsed.kind !== "conversation.appearance.changed" &&
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
    if (
      parsed.kind === "conversation.created" &&
      parsed.conversation === undefined
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
    // A membership announcement without an actor or with an action outside the
    // closed set is refused rather than forwarded. A receiver acts on the action
    // (a dissolve is terminal, a role change is not) and on the actor, so an
    // unrecognised value would have to be guessed at.
    if (
      parsed.kind === "den.membership.changed" &&
      (typeof parsed.userId !== "string" ||
        !isDenMembershipAction(parsed.membershipAction))
    ) {
      return null;
    }
    return {
      conversation: parsed.conversation,
      conversationId: parsed.conversationId,
      deliveredAt: parsed.deliveredAt,
      kind: parsed.kind,
      // Narrowed above: an event that reached this line either is not a
      // membership announcement (so this is undefined) or carried a valid one.
      membershipAction: isDenMembershipAction(parsed.membershipAction)
        ? parsed.membershipAction
        : undefined,
      membershipSeq: readMembershipSeq(parsed.membershipSeq),
      message: parsed.message,
      readAt: parsed.readAt,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

export async function publishMessageEvent(
  event: MessageStreamEvent
): Promise<void> {
  try {
    await redis.publish(
      messageChannel(event.conversationId),
      serializeMessageEvent(event)
    );
  } catch (error) {
    console.error("Error publishing message event:", error);
  }
}

export async function publishMessageCreated(
  conversationId: string,
  message: unknown
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "message.created",
    message,
  });
}

export async function publishMessageDeleted(
  conversationId: string,
  message: unknown
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "message.deleted",
    message,
  });
}

// An in-place rewrite: the same message id with a new ciphertext/IV (and
// `editedAt`). No key material rides along, so it is safe to broadcast; the
// receiver re-decrypts the row with the ratchet index it already had.
export async function publishMessageEdited(
  conversationId: string,
  message: unknown
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "message.edited",
    message,
  });
}

export async function publishConversationRead(
  conversationId: string,
  userId: string,
  readAt: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "conversation.read",
    readAt,
    userId,
  });
}

// A member confirmed receipt of messages up to `deliveredAt` (an ISO string).
// The sender folds this to flip its own bubbles to Delivered without refetching
// the transcript.
export async function publishConversationDelivered(
  conversationId: string,
  userId: string,
  deliveredAt: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    deliveredAt,
    kind: "conversation.delivered",
    userId,
  });
}

export async function publishTypingStarted(
  conversationId: string,
  userId: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "typing.started",
    userId,
  });
}

// Signals that a member posted new wrapped root keys, so every other open
// thread refetches the conversation detail instead of trusting a snapshot whose
// wraps or peer public key may now be stale. Sent by the keys route after a
// successful append (the first send in a conversation, an epoch rotation, or a
// missing-peer-wrap heal). No key material rides along.
export async function publishMessageKeysRotated(
  conversationId: string,
  userId: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "keys.rotated",
    userId,
  });
}

// A den's roster moved. Two audiences, one call:
//
//   - `messages:<conversationId>`, for whoever has the thread open. Every
//     connection on it re-checks its own membership row, which is how a removed
//     member's already-open stream is told to stop before it can deliver
//     anything else.
//   - `message-activity:<userId>` for each id in `memberIds`, because the
//     conversation LIST is about the threads nobody has open. That is what makes
//     a den somebody just joined appear in their rail, and what drops a
//     dissolved or left den out of theirs.
//
// `memberIds` is the roster as it stands AFTER the mutation, which deliberately
// includes whoever left or was removed: they are no longer members, and their
// list still shows the den until they refetch it. A dissolved den can arrive
// with nobody left at all, so an empty list is a normal input and publishes only
// the conversation channel.
//
// `membershipSeq` rides only on the conversation channel, and that is a decision
// rather than an oversight. The per-member activity channel's only consumer is
// the conversation LIST, which refetches on ANY activity frame without reading
// the payload (`useMessageActivity` takes a `() => void`), so a counter there
// would widen every idle tab's frame for a reader that does not exist. The
// per-conversation stream is the place where a client compares sequences, and
// that is where it goes.
//
// The counter is not sensitive: it is a small integer, and the only thing a
// holder can learn from it is how many roster changes they may have missed. It
// names nobody and carries no key, body, ciphertext or code.
//
// Best-effort throughout, so a pub/sub outage cannot fail the membership write
// that already committed: every failure here is logged and swallowed, and the
// clients' own polling and the stream's heartbeat re-check are the fallback.
export async function publishDenMembershipChanged(
  event: DenMembershipEvent
): Promise<void> {
  const { action, actorId, conversationId, memberIds, membershipSeq } = event;
  await publishMessageEvent({
    conversationId,
    kind: "den.membership.changed",
    membershipAction: action,
    membershipSeq,
    userId: actorId,
  });
  try {
    await Promise.all(
      memberIds.map((userId) =>
        publishMessageActivity(userId, {
          conversationId,
          kind: "den.membership.changed",
        })
      )
    );
  } catch (error) {
    console.error("Error publishing den membership activity:", error);
  }
}

// A per-user channel for "something happened in one of your conversations".
//
// The per-conversation channel above only reaches clients with that conversation
// OPEN. The conversation list needs the opposite: it must learn about a message in a
// thread nobody has open, which is the whole point of a list. So this channel is
// per USER and its payload is deliberately tiny -- the conversation id, nothing
// else. Carrying the message would duplicate the conversation channel and hand every
// idle tab a copy of ciphertext it is not going to read.
//
// The event is a SIGNAL rather than data: the only correct response is to refetch
// the list, which already knows how to order and preview itself. Nothing here is
// secret, which is also why it is safe to publish to a user id.
export const MESSAGE_ACTIVITY_CHANNEL_PREFIX = "message-activity:";

export const messageActivityChannel = (userId: string): string =>
  `${MESSAGE_ACTIVITY_CHANNEL_PREFIX}${userId}`;

export interface MessageActivityEvent {
  conversationId: string;
  // `message.created` is the ordinary case. `den.membership.changed` is the same
  // signal for a roster move: the list has to re-read itself either way, because
  // the server owns the ordering, the preview and the member count.
  kind: "den.membership.changed" | "message.created";
}

export function serializeMessageActivityEvent(
  event: MessageActivityEvent
): string {
  return JSON.stringify(event);
}

export function parseMessageActivityEvent(
  raw: string
): MessageActivityEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageActivityEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "den.membership.changed"
    ) {
      return null;
    }
    if (
      typeof parsed.conversationId !== "string" ||
      parsed.conversationId.length === 0
    ) {
      return null;
    }
    return { conversationId: parsed.conversationId, kind: parsed.kind };
  } catch {
    return null;
  }
}

// Best-effort, like every other publish here: a message that is committed must not
// turn into an error because the fan-out failed. The list's own polling is the
// fallback when this is not delivered.
export async function publishMessageActivity(
  userId: string,
  event: MessageActivityEvent
): Promise<void> {
  try {
    await redis.publish(
      messageActivityChannel(userId),
      serializeMessageActivityEvent(event)
    );
  } catch (error) {
    console.error("Error publishing message activity:", error);
  }
}

// Security events use a per-user channel. They carry no credential material:
// a browser receives only enough information to know whether its own session
// must close after a server-confirmed revocation.
export const SESSION_EVENT_CHANNEL_PREFIX = "session-events:";

export const sessionEventChannel = (userId: string): string =>
  `${SESSION_EVENT_CHANNEL_PREFIX}${userId}`;

export interface SessionRevocationEvent {
  kind: "session.revoked";
  retainedSessionId?: string;
  revokedSessionId?: string;
}

export function serializeSessionRevocationEvent(
  event: SessionRevocationEvent
): string {
  return JSON.stringify(event);
}

export function parseSessionRevocationEvent(
  raw: string
): SessionRevocationEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionRevocationEvent>;
    if (parsed.kind !== "session.revoked") {
      return null;
    }
    if (
      (parsed.retainedSessionId !== undefined &&
        typeof parsed.retainedSessionId !== "string") ||
      (parsed.revokedSessionId !== undefined &&
        typeof parsed.revokedSessionId !== "string") ||
      (parsed.retainedSessionId !== undefined &&
        parsed.revokedSessionId !== undefined)
    ) {
      return null;
    }
    return {
      kind: "session.revoked",
      retainedSessionId: parsed.retainedSessionId,
      revokedSessionId: parsed.revokedSessionId,
    };
  } catch {
    return null;
  }
}

export async function publishSessionRevocation(
  userId: string,
  event: Omit<SessionRevocationEvent, "kind">
): Promise<void> {
  try {
    await redis.publish(
      sessionEventChannel(userId),
      serializeSessionRevocationEvent({ kind: "session.revoked", ...event })
    );
  } catch (error) {
    console.error("Error publishing session revocation event:", error);
  }
}

// ---- presence ---------------------------------------------------------------
// Users on the Messages page heartbeat their online status every 30s. The
// per-user key carries the TTL so a stale heartbeat expires on its own, and
// the sets are only indexes over those keys (stale members are pruned on
// read). Two tiers:
//   - online: heartbeat received within PRESENCE_TTL_SECONDS (green dot)
//   - idle:   seen within PRESENCE_SEEN_TTL_SECONDS but no recent heartbeat
//             (amber dot) — e.g. the tab is open but the user stepped away
//             past the heartbeat window, or they closed it moments ago.
export const PRESENCE_PREFIX = "presence:";
export const PRESENCE_SEEN_PREFIX = "presence:seen:";
export const PRESENCE_ONLINE_SET = "presence:online";
export const PRESENCE_SEEN_SET = "presence:seen";
export const PRESENCE_TTL_SECONDS = 70;
export const PRESENCE_SEEN_TTL_SECONDS = 900;

export async function markUserOnline(userId: string): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.setex(
      `${PRESENCE_PREFIX}${userId}`,
      PRESENCE_TTL_SECONDS,
      String(Date.now())
    );
    pipeline.setex(
      `${PRESENCE_SEEN_PREFIX}${userId}`,
      PRESENCE_SEEN_TTL_SECONDS,
      String(Date.now())
    );
    pipeline.sadd(PRESENCE_ONLINE_SET, userId);
    pipeline.sadd(PRESENCE_SEEN_SET, userId);
    await pipeline.exec();
  } catch (error) {
    console.error("Error marking user online:", error);
  }
}

// Returns members whose per-user online key is still alive, pruning (srem)
// members whose key expired. The key is the source of truth; without this
// prune the set would keep everyone online forever.
export async function getOnlineUsers(): Promise<string[]> {
  try {
    const members = await redis.smembers(PRESENCE_ONLINE_SET);
    if (members.length === 0) {
      return [];
    }
    const pipeline = redis.pipeline();
    for (const id of members) {
      pipeline.get(`${PRESENCE_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const online: string[] = [];
    const stale: string[] = [];
    for (let index = 0; index < members.length; index += 1) {
      const value = results?.[index]?.[1];
      if (typeof value === "string") {
        online.push(members[index]);
      } else {
        stale.push(members[index]);
      }
    }
    if (stale.length > 0) {
      await redis.srem(PRESENCE_ONLINE_SET, ...stale);
    }
    return online;
  } catch (error) {
    console.error("Error getting online users:", error);
    return [];
  }
}

// Users seen recently but not currently online (heartbeat expired within the
// seen window). Prunes seen members whose seen key expired. Accepts the
// already-computed online list so the caller (the presence route) does not
// query the online set twice per poll.
export async function getIdleUsers(onlineList: string[]): Promise<string[]> {
  try {
    const seen = await redis.smembers(PRESENCE_SEEN_SET);
    if (seen.length === 0) {
      return [];
    }
    const online = new Set(onlineList);
    const candidates = seen.filter((id) => !online.has(id));
    if (candidates.length === 0) {
      return [];
    }

    const pipeline = redis.pipeline();
    for (const id of candidates) {
      pipeline.get(`${PRESENCE_SEEN_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const idle: string[] = [];
    const stale: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const value = results?.[index]?.[1];
      if (typeof value === "string") {
        idle.push(candidates[index]);
      } else {
        stale.push(candidates[index]);
      }
    }
    if (stale.length > 0) {
      await redis.srem(PRESENCE_SEEN_SET, ...stale);
    }
    return idle;
  } catch (error) {
    console.error("Error getting idle users:", error);
    return [];
  }
}

// Redis Streams that buffer high-frequency counter increments for the worker.
// The web app XADDs a small event per increment; the worker drains them in
// batches (XREADGROUP) and flushes the aggregate deltas to Postgres.
export const VIEWS_STREAM = "views:stream";
export const VIEWS_GROUP = "views-flush";
export const VIEWS_CONSUMER_PREFIX = "views-worker";

export const SHARE_STREAM = "share:stream";
export const SHARE_GROUP = "share-flush";
export const SHARE_CONSUMER_PREFIX = "share-worker";

export async function ensureStreamGroups(): Promise<void> {
  await Promise.all([
    ensureGroup(VIEWS_STREAM, VIEWS_GROUP),
    ensureGroup(SHARE_STREAM, SHARE_GROUP),
  ]);
}

async function ensureGroup(stream: string, group: string): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (error) {
    // BUSYGROUP means the group already exists, which is fine.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("BUSYGROUP")) {
      console.error(`Error creating consumer group ${group}:`, error);
    }
  }
}

export async function enqueueViewIncrement(postId: string): Promise<void> {
  try {
    await redis.xadd(
      VIEWS_STREAM,
      "MAXLEN",
      "~",
      10_000,
      "*",
      "postId",
      postId
    );
  } catch (error) {
    console.error("Error enqueuing view increment:", error);
  }
}

export async function enqueueShareEvent(
  postId: string,
  platform: string,
  kind: "share" | "click"
): Promise<void> {
  try {
    await redis.xadd(
      SHARE_STREAM,
      "MAXLEN",
      "~",
      10_000,
      "*",
      "postId",
      postId,
      "platform",
      platform,
      "kind",
      kind
    );
  } catch (error) {
    console.error("Error enqueuing share event:", error);
  }
}

// Best-effort one-shot claim backed by SET NX EX. Returns true when this
// caller is the first to claim `key` inside the TTL window. Used for
// exactly-once semantics on soft events (view counting, share clicks) where
// dropping a duplicate is always preferable to counting it twice. Fails open
// (returns true) when Redis is unreachable so real events are never lost.
export async function claimOnce(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  try {
    // ioredis resolves SET ... NX to "OK" when the key was claimed and to
    // null when it already existed, so only "OK" counts as a fresh claim.
    const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (error) {
    console.error("claim-once redis unavailable, failing open:", error);
    return true;
  }
}

// View deduplication windows: both anonymous clients (hashed IP) and signed-in
// users (userId) deduplicate per post for 15 minutes. Repeat views after the
// window reflect genuine return engagement, while short-interval refresh loops
// or scripted pings are deduplicated atomically.
const ANON_VIEW_DEDUP_TTL_SECONDS = 900;
const USER_VIEW_DEDUP_TTL_SECONDS = 900;

// Atomically claims the dedupe key and increments the counter in one script so
// a duplicate claim can never race an increment (no double-count window).
// KEYS[1] = dedupe key ("" when there is no viewer identity), KEYS[2] = the
// set of posts with counters, KEYS[3] = the per-post counter.
// Returns a 2-element list: [wasIncremented (1 or 0), currentCounter].
const CLAIM_AND_INCREMENT_SCRIPT = `
if KEYS[1] ~= "" then
  local ok = redis.call("SET", KEYS[1], "1", "EX", tonumber(ARGV[1]), "NX")
  if not ok then
    local current = redis.call("GET", KEYS[3])
    if current then return {0, tonumber(current)} end
    return {0, 0}
  end
end
redis.call("SADD", KEYS[2], ARGV[2])
local newCount = redis.call("INCR", KEYS[3])
return {1, newCount}
`;

export const postViewsCache = {
  async getMultipleViews(postIds: string[]): Promise<Record<string, number>> {
    try {
      const pipeline = redis.pipeline();
      for (const id of postIds) {
        pipeline.get(`${POST_VIEWS_KEY_PREFIX}${id}`);
      }

      const results = await pipeline.exec();

      const views: Record<string, number> = {};
      for (let index = 0; index < postIds.length; index += 1) {
        const id = postIds[index];
        views[id] = Math.trunc(
          Number((results?.[index]?.[1] as string) || "0")
        );
      }
      return views;
    } catch (error) {
      console.error("Error getting multiple post views:", error);
      return {};
    }
  },

  async getViews(postId: string): Promise<number> {
    try {
      const views = await redis.get(`${POST_VIEWS_KEY_PREFIX}${postId}`);
      console.log(`Redis: Got views: ${views}`);
      return Math.trunc(Number(views || "0"));
    } catch (error) {
      console.error("Error getting post views:", error);
      return 0;
    }
  },

  async incrementView(
    postId: string,
    viewer?: { userId?: string; viewerHash?: string }
  ): Promise<number> {
    try {
      // Deduplicate views: signed-in viewers dedupe per user+post; anonymous
      // viewers dedupe per hashed IP+post (15 minutes). Both fail open, so
      // genuine views are never lost to an infrastructure hiccup.
      let dedupeKey = "";
      let ttlSeconds = ANON_VIEW_DEDUP_TTL_SECONDS;
      if (viewer?.userId) {
        dedupeKey = `${POST_VIEWS_KEY_PREFIX}seen:${postId}:u:${viewer.userId}`;
        ttlSeconds = USER_VIEW_DEDUP_TTL_SECONDS;
      } else if (viewer?.viewerHash) {
        dedupeKey = `${POST_VIEWS_KEY_PREFIX}seen:${postId}:a:${viewer.viewerHash}`;
        ttlSeconds = ANON_VIEW_DEDUP_TTL_SECONDS;
      }

      const evalResult = (await redis.eval(
        CLAIM_AND_INCREMENT_SCRIPT,
        3,
        dedupeKey,
        POST_VIEWS_SET,
        `${POST_VIEWS_KEY_PREFIX}${postId}`,
        ttlSeconds,
        postId
      )) as unknown;

      let wasIncremented = true;
      let newCount = 0;
      if (Array.isArray(evalResult)) {
        wasIncremented = Number(evalResult[0]) === 1;
        newCount = Number(evalResult[1] || 0);
      } else {
        newCount = Number(evalResult || 0);
      }

      if (wasIncremented) {
        await enqueueViewIncrement(postId);
      }

      return newCount;
    } catch (error) {
      console.error("Error incrementing post view:", error);
      return 0;
    }
  },

  async isInViewSet(postId: string): Promise<boolean> {
    try {
      return (await redis.sismember(POST_VIEWS_SET, postId)) === 1;
    } catch (error) {
      console.error("Error checking post in view set:", error);
      return false;
    }
  },
};

// Adds the live Redis view delta on top of each post's persisted viewCount so
// the UI shows near-instant counts while the worker batch-flushes deltas to
// Postgres. Accepts any array of objects that carry `id` and `viewCount`.
// Also normalizes viewer-scoped joins (`bookmarks`, `vote`) that older caches
// or optimistically constructed rows may omit, so downstream
// `post.bookmarks.some(...)` never throws in production (the "some is undefined"
// Next.js 12 crash).
export async function hydrateViewCounts<
  T extends { id: string; viewCount: number },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) {
    return items;
  }
  const deltas = await postViewsCache.getMultipleViews(
    items.map((item) => item.id)
  );
  return items.map((item) => {
    const viewCount = item.viewCount + (deltas[item.id] ?? 0);
    const record = item as unknown as Record<string, unknown>;
    // If this is a PostData-like row, patch missing viewer joins. Spread
    // first so the original is not mutated, then assign defaults only when
    // the field is not already an array.
    const next: T = { ...item, viewCount } as T;
    const isPostLike = "aura" in record && "userId" in record;
    if (
      (isPostLike || "bookmarks" in record) &&
      !Array.isArray(record.bookmarks)
    ) {
      (next as unknown as Record<string, unknown>).bookmarks = [];
    }
    if ((isPostLike || "vote" in record) && !Array.isArray(record.vote)) {
      (next as unknown as Record<string, unknown>).vote = [];
    }
    if (
      (isPostLike || "attachments" in record) &&
      !Array.isArray(record.attachments)
    ) {
      (next as unknown as Record<string, unknown>).attachments = [];
    }
    if ((isPostLike || "tags" in record) && !Array.isArray(record.tags)) {
      (next as unknown as Record<string, unknown>).tags = [];
    }
    if (
      (isPostLike || "mentions" in record) &&
      !Array.isArray(record.mentions)
    ) {
      (next as unknown as Record<string, unknown>).mentions = [];
    }
    if (isPostLike || "_count" in record) {
      const count = record._count as Record<string, unknown> | undefined;
      if (!count || typeof count !== "object") {
        (next as unknown as Record<string, unknown>)._count = {
          comments: 0,
          mentions: 0,
          vote: 0,
        };
      }
    }
    return next;
  });
}

export interface CachedSession {
  session: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string;
    userAgent?: string;
  };
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    username?: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export const jwtSessionCache = {
  createTokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex").slice(0, 16);
  },

  async getJWKS(): Promise<JSONWebKeySet | null> {
    try {
      const cached = await redis.get(JWKS_CACHE_KEY);
      if (cached) {
        console.log("Retrieved JWKS from cache");
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached JWKS:", error);
      return null;
    }
  },

  async getValidatedSession(tokenHash: string): Promise<CachedSession | null> {
    try {
      const cached = await redis.get(`${SESSION_CACHE_KEY_PREFIX}${tokenHash}`);
      if (cached) {
        console.log(
          `Retrieved validated session from cache for token hash: ${tokenHash.slice(0, 8)}...`
        );
        const sessionData = JSON.parse(cached);
        sessionData.session.expiresAt = new Date(sessionData.session.expiresAt);
        sessionData.user.createdAt = new Date(sessionData.user.createdAt);
        sessionData.user.updatedAt = new Date(sessionData.user.updatedAt);
        return sessionData;
      }
      return null;
    } catch (error) {
      console.error("Error getting cached validated session:", error);
      return null;
    }
  },

  async invalidateSession(tokenHash: string): Promise<void> {
    try {
      await redis.del(`${SESSION_CACHE_KEY_PREFIX}${tokenHash}`);
      console.log(
        `Invalidated cached session for token hash: ${tokenHash.slice(0, 8)}...`
      );
    } catch (error) {
      console.error("Error invalidating cached session:", error);
    }
  },

  async setJWKS(jwks: JSONWebKeySet): Promise<void> {
    try {
      await redis.setex(JWKS_CACHE_KEY, JWKS_CACHE_TTL, JSON.stringify(jwks));
      console.log("Cached JWKS in Redis");
    } catch (error) {
      console.error("Error caching JWKS:", error);
    }
  },

  async setValidatedSession(
    tokenHash: string,
    sessionData: CachedSession
  ): Promise<void> {
    try {
      await redis.setex(
        `${SESSION_CACHE_KEY_PREFIX}${tokenHash}`,
        SESSION_CACHE_TTL,
        JSON.stringify(sessionData)
      );
      console.log(
        `Cached validated session for token hash: ${tokenHash.slice(0, 8)}...`
      );
    } catch (error) {
      console.error("Error caching validated session:", error);
    }
  },
};
