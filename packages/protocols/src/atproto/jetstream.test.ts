import { expect, test } from "bun:test";

import { MalformedError, websocketTransport } from "@bsky/jetstream";

import { authorDid, eventFixture } from "../testing/fixtures";
import {
  jetstreamRecordUri,
  jetstreamUrl,
  parseJetstreamEvent,
  streamJetstream,
} from "./jetstream";

test("subscriptions always require a bounded account set and keep account events", () => {
  expect(() => jetstreamUrl({ dids: [] })).toThrow();
  const url = new URL(
    jetstreamUrl({ cursor: 10, dids: [authorDid, authorDid] })
  );
  expect(url.searchParams.getAll("dids")).toEqual([authorDid]);
  expect(url.searchParams.has("kinds")).toBe(false);
  expect(url.searchParams.get("cursor")).toBe("10");
  expect(url.pathname).toBe("/xrpc/network.bsky.jetstream.subscribeEvents");
});

test("public discovery is explicit and cannot subscribe to unrelated collections or tracked DIDs", () => {
  const url = new URL(jetstreamUrl({ dids: [], publicDiscovery: true }));
  expect(url.searchParams.has("dids")).toBe(false);
  expect(url.searchParams.getAll("collections")).toContain(
    "app.bsky.feed.post"
  );
  expect(url.searchParams.getAll("kinds")).toEqual([
    "commit",
    "identity",
    "account",
  ]);
  expect(() =>
    jetstreamUrl({
      collections: ["app.bsky.graph.follow"],
      dids: [],
      publicDiscovery: true,
    })
  ).toThrow();
  expect(() =>
    jetstreamUrl({ dids: [authorDid], publicDiscovery: true })
  ).toThrow();
});

test("public discovery filters sync frames at the actual SDK subscription and reconciles undecodable replays", async () => {
  const stream = streamJetstream({
    dids: [],
    publicDiscovery: true,
    transport: {
      async *stream(getUrl) {
        const url = new URL(await getUrl());
        expect(url.searchParams.get("maxMessageSizeBytes")).toBe("262144");
        expect(url.searchParams.getAll("kinds")).toEqual([
          "commit",
          "identity",
          "account",
        ]);
        yield* [];
        throw new MalformedError("wire validation failed at an old sync frame");
      },
    },
  });
  await expect(stream.next()).rejects.toMatchObject({
    code: "invalid_response",
    message: "Jetstream cursor requires reconciliation",
  });
});

test("validates deletes, account events, payload bounds, and v2 cursors", () => {
  const parsed = parseJetstreamEvent(JSON.stringify(eventFixture));
  if (parsed.kind === "commit") {
    expect(jetstreamRecordUri(parsed)).toContain("/app.bsky.feed.post/example");
  }
  expect(
    parseJetstreamEvent(
      JSON.stringify({
        ...eventFixture,
        account: { active: false, status: "deleted" },
        kind: "account",
      })
    ).kind
  ).toBe("account");
  expect(() => parseJetstreamEvent("bad JSON")).toThrow();
  expect(() =>
    parseJetstreamEvent(JSON.stringify({ ...eventFixture, seq: undefined }))
  ).toThrow();
  expect(() => parseJetstreamEvent(JSON.stringify(eventFixture), 10)).toThrow();
});

const frame = (seq: number, record: unknown) =>
  JSON.stringify({
    $type: "message",
    payload: {
      $type: "network.bsky.jetstream.subscribeEvents#commit",
      did: authorDid,
      seq,
      time: eventFixture.time,
      ...eventFixture.commit,
      record,
    },
  });

test("public discovery skips one malformed record and continues, and an oversized replay requests reconciliation", async () => {
  const stream = streamJetstream({
    dids: [],
    publicDiscovery: true,
    transport: {
      async *stream() {
        yield frame(1, {});
        yield frame(2, eventFixture.commit.record);
      },
    },
  });
  const first = await stream.next();
  const completed = await stream.next();
  expect(first.value?.seq).toBe(2);
  expect(completed.done).toBe(true);
  const oversized = streamJetstream({
    dids: [],
    maxMessageBytes: 100,
    publicDiscovery: true,
    transport: {
      async *stream() {
        yield frame(1, eventFixture.commit.record);
      },
    },
  });
  await expect(oversized.next()).rejects.toMatchObject({
    code: "invalid_response",
    message: "Jetstream cursor requires reconciliation",
  });
});

test("reads the real WebSocket lifecycle and closes on cancellation", async () => {
  const controller = new AbortController();
  let connected = false;
  const server = Bun.serve({
    fetch(request, connection) {
      if (connection.upgrade(request)) {
        return;
      }
      return new Response("Upgrade required", { status: 400 });
    },
    hostname: "127.0.0.1",
    port: 0,
    websocket: {
      message() {},
      open(socket) {
        socket.send(
          JSON.stringify({
            $type: "message",
            payload: {
              $type: "network.bsky.jetstream.subscribeEvents#commit",
              did: eventFixture.did,
              seq: eventFixture.seq,
              time: eventFixture.time,
              ...eventFixture.commit,
            },
          })
        );
      },
    },
  });
  try {
    const stream = streamJetstream({
      dids: [authorDid],
      onConnected: () => {
        connected = true;
      },
      signal: controller.signal,
      transport: {
        stream: (_url, signal, options) =>
          websocketTransport({ shouldReconnect: false }).stream(
            () => `ws://127.0.0.1:${server.port}`,
            signal,
            options
          ),
      },
    });
    const first = await stream.next();
    expect(connected).toBe(true);
    expect(first.value?.seq).toBe(101);
    controller.abort();
    const awaitedResponse1 = await stream.next();
    expect(awaitedResponse1.done).toBe(true);
  } finally {
    controller.abort();
    await server.stop(true);
  }
});
