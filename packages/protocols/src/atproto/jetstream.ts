import { ensureValidNsid } from "@atproto/syntax";
import {
  Jetstream,
  MalformedError,
  RecordValidationError,
  XrpcSubscriptionError,
  websocketTransport,
} from "@bsky/jetstream";
import type { LiveTransport } from "@bsky/jetstream";
import { z } from "zod";

import { didSchema } from "../bluesky/schemas";
import { ProtocolError } from "../contracts";
import { readJsonBounded } from "../transport";

const base = {
  did: didSchema,
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  time: z.iso.datetime({ offset: true }),
};
const collectionSchema = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[a-zA-Z0-9.-]+$/);
const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    commit: z.object({
      cid: z.string().max(512).optional(),
      collection: collectionSchema,
      operation: z.enum(["create", "update", "delete"]),
      record: z.unknown().optional(),
      rkey: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-zA-Z0-9._~:-]+$/),
    }),
    kind: z.literal("commit"),
  }),
  z.object({
    ...base,
    identity: z.object({ handle: z.string().max(253).optional() }),
    kind: z.literal("identity"),
  }),
  z.object({
    ...base,
    account: z.object({
      active: z.boolean(),
      status: z.string().max(100).optional(),
    }),
    kind: z.literal("account"),
  }),
  z.object({
    ...base,
    kind: z.literal("sync"),
    sync: z.object({ rev: z.string().max(512).optional() }),
  }),
]);

export type JetstreamEvent = z.infer<typeof eventSchema>;
export const jetstreamEndpoints = [
  "wss://jetstream.us-east.bsky.network",
  "wss://jetstream.us-west.bsky.network",
] as const;
export type JetstreamEndpoint = (typeof jetstreamEndpoints)[number];
const discoveryKinds = ["commit", "identity", "account"] as const;

export interface JetstreamOptions {
  dids: string[];
  publicDiscovery?: boolean;
  collections?: string[];
  cursor?: number;
  endpoint?: JetstreamEndpoint;
  signal?: AbortSignal;
  maxBufferedBytes?: number;
  maxMessageBytes?: number;
  connectTimeoutMs?: number;
  transport?: LiveTransport;
  onConnected?: () => void;
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}

export function jetstreamUrl(
  options: Pick<
    JetstreamOptions,
    "dids" | "collections" | "cursor" | "endpoint" | "publicDiscovery"
  >
): string {
  const parsed = z
    .object({
      collections: z
        .array(collectionSchema)
        .min(1)
        .max(100)
        .default([
          "app.bsky.feed.post",
          "app.bsky.actor.profile",
          "app.bsky.actor.contentVisibilityDeclaration",
          "app.bsky.feed.threadgate",
          "app.bsky.feed.postgate",
        ]),
      cursor: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      dids: z.array(didSchema).max(1000),
      endpoint: z.enum(jetstreamEndpoints).default(jetstreamEndpoints[0]),
      publicDiscovery: z.boolean().default(false),
    })
    .refine((value) =>
      value.publicDiscovery
        ? value.dids.length === 0 &&
          value.collections.every((collection) =>
            [
              "app.bsky.feed.post",
              "app.bsky.actor.profile",
              "app.bsky.actor.contentVisibilityDeclaration",
              "app.bsky.feed.threadgate",
              "app.bsky.feed.postgate",
            ].includes(collection)
          )
        : value.dids.length > 0
    )
    .safeParse(options);
  if (!parsed.success) {
    throw new ProtocolError(
      "invalid_input",
      "Jetstream needs a bounded set of valid accounts and collections"
    );
  }
  const url = new URL(
    "/xrpc/network.bsky.jetstream.subscribeEvents",
    parsed.data.endpoint
  );
  for (const did of [...new Set(parsed.data.dids)].toSorted()) {
    url.searchParams.append("dids", did);
  }
  for (const collection of [...new Set(parsed.data.collections)].toSorted()) {
    url.searchParams.append("collections", collection);
  }
  if (parsed.data.publicDiscovery) {
    for (const kind of discoveryKinds) {
      url.searchParams.append("kinds", kind);
    }
  }
  if (parsed.data.cursor !== undefined) {
    url.searchParams.set("cursor", String(parsed.data.cursor));
  }
  return url.href;
}

export function parseJetstreamEvent(
  message: string,
  maxBytes = 256 * 1024
): JetstreamEvent {
  if (new TextEncoder().encode(message).byteLength > maxBytes) {
    throw new ProtocolError(
      "invalid_response",
      "Jetstream event exceeds the size limit"
    );
  }
  try {
    const parsed = eventSchema.safeParse(JSON.parse(message));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    throw new ProtocolError("invalid_response", "Invalid Jetstream event");
  }
  throw new ProtocolError("invalid_response", "Invalid Jetstream event");
}

export function jetstreamRecordUri(
  event: Extract<JetstreamEvent, { kind: "commit" }>
): string {
  return `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`;
}

export async function* streamJetstream(
  options: JetstreamOptions
): AsyncGenerator<JetstreamEvent> {
  const subscription = new URL(jetstreamUrl(options));
  const maxBufferedBytes = options.maxBufferedBytes ?? 1024 * 1024;
  const maxMessageBytes = options.maxMessageBytes ?? 256 * 1024;
  const timeoutMs = options.connectTimeoutMs ?? 10_000;
  for (const limit of [maxBufferedBytes, maxMessageBytes, timeoutMs]) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new RangeError("Stream limits must be positive safe integers");
    }
  }
  if (options.signal?.aborted) {
    return;
  }
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let opened = false;
  const timer = setTimeout(() => {
    controller.abort(
      new ProtocolError("unavailable", "Jetstream connection timed out")
    );
  }, timeoutMs);
  const connected = () => {
    if (opened) {
      return;
    }
    opened = true;
    clearTimeout(timer);
    try {
      options.onConnected?.();
    } catch {
      // Connection observers must not interrupt stream consumption.
    }
  };
  const transport =
    options.transport ??
    websocketTransport({
      // Bun's ws pause/resume methods are stubs; its hard byte ceiling still rejects overflow before the watermark.
      highWaterMark:
        "Bun" in globalThis
          ? maxBufferedBytes
          : Math.min(maxBufferedBytes, 256 * 1024),
      idleTimeoutMs: false,
      maxBufferedBytes,
      onOpen: connected,
      shouldReconnect: false,
    });
  const boundedTransport: LiveTransport = {
    async *stream(getUrl, transportSignal, transportOptions) {
      for await (const message of transport.stream(
        () => {
          const url = new URL(getUrl());
          // Filter oversized records before delivery so a checkpoint cannot replay the same poison frame forever.
          url.searchParams.set("maxMessageSizeBytes", String(maxMessageBytes));
          return url.toString();
        },
        transportSignal,
        transportOptions
      )) {
        const size =
          typeof message === "string"
            ? new TextEncoder().encode(message).byteLength
            : message.byteLength;
        if (size > maxMessageBytes) {
          throw new ProtocolError(
            "invalid_response",
            "Jetstream event exceeds the size limit"
          );
        }
        yield message;
      }
    },
  };
  const client = new Jetstream({
    service: subscription.origin.replace("wss:", "https:"),
    validateWire: true,
  });
  try {
    for await (const event of client.live({
      collections: subscription.searchParams
        .getAll("collections")
        .map((collection) => {
          ensureValidNsid(collection);
          return collection;
        }),
      cursor: {
        load: () => Promise.resolve(options.cursor),
        save: () => Promise.resolve(),
      },
      dids: options.dids.map((did) => didSchema.parse(did)),
      kinds: options.publicDiscovery ? [...discoveryKinds] : undefined,
      liveTransport: boundedTransport,
      onError: (error) => {
        if (options.publicDiscovery && error instanceof RecordValidationError) {
          // The SDK skips this unusable record; AppView hydration remains the eligibility boundary.
          return;
        }
        controller.abort(
          new ProtocolError(
            "invalid_response",
            "Jetstream record validation failed"
          )
        );
      },
      onInfo: () => {
        controller.abort(
          new ProtocolError(
            "unavailable",
            "Jetstream cursor requires reconciliation"
          )
        );
      },
      signal,
    })) {
      connected();
      const validated = eventSchema.safeParse(event);
      if (!validated.success) {
        throw new ProtocolError(
          "invalid_response",
          "Invalid decoded Jetstream event"
        );
      }
      yield validated.data;
    }
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }
    if (signal.reason instanceof ProtocolError) {
      if (
        options.publicDiscovery &&
        signal.reason.code === "invalid_response"
      ) {
        throw new ProtocolError(
          "invalid_response",
          "Jetstream cursor requires reconciliation"
        );
      }
      throw signal.reason;
    }
    // The websocket SDK discards failed upgrade bodies. Confirm CursorTooOld over HTTP before resetting a durable cursor.
    if (
      options.cursor !== undefined &&
      !opened &&
      error instanceof Error &&
      error.name === "SocketError"
    ) {
      try {
        const url = new URL(subscription);
        url.protocol = "https:";
        const probeSignal = options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)])
          : AbortSignal.timeout(3000);
        const response = await (options.fetch ?? globalThis.fetch)(url, {
          redirect: "error",
          signal: probeSignal,
        });
        const body = await readJsonBounded(response, 4096, probeSignal);
        if (
          response.status === 400 &&
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          body.error === "CursorTooOld"
        ) {
          throw new ProtocolError(
            "invalid_response",
            "Jetstream cursor requires reconciliation"
          );
        }
      } catch (probeError) {
        if (probeError instanceof ProtocolError) {
          throw probeError;
        }
      }
    }
    if (
      (options.publicDiscovery &&
        error instanceof ProtocolError &&
        error.message === "Jetstream event exceeds the size limit") ||
      (options.publicDiscovery && error instanceof MalformedError) ||
      (options.publicDiscovery &&
        error instanceof Error &&
        error.name === "BufferOverflowError") ||
      (error instanceof XrpcSubscriptionError &&
        (error.error === "CursorTooOld" ||
          (options.publicDiscovery && error.error === "ConsumerTooSlow")))
    ) {
      throw new ProtocolError(
        "invalid_response",
        "Jetstream cursor requires reconciliation"
      );
    }
    throw error instanceof ProtocolError
      ? error
      : new ProtocolError(
          "unavailable",
          error instanceof Error
            ? `Jetstream ${error.name}: ${error.message}`
            : "Jetstream connection failed"
        );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
