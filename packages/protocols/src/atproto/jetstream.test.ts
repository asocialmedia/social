import { expect, test } from "bun:test";

import { websocketTransport } from "@bsky/jetstream";

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
