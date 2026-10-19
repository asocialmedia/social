import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type {
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatPermissions,
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";

// oxlint-disable no-await-in-loop -- Acceptance steps deliberately verify ordered HTTP effects.

const origin = "http://localhost:3000";
const base = "/api/communities/community-chat-playground/chat";
const run = randomUUID().slice(0, 8);
const results: {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}[] = [];
type Client = { cookie: string; username: string };
type History = CommunityChatMessagePage & {
  permissions: CommunityChatPermissions;
  room: CommunityChatRoom;
};
type MessageResult = { message: CommunityChatMessage; replayed: boolean };

async function request<T>(
  client: Client | null,
  path: string,
  method = "GET",
  body?: unknown
) {
  await Bun.sleep(250);
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      ...(client ? { cookie: client.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `${method} ${path} returned non-JSON HTTP ${response.status}`
      );
    }
  }
  return {
    status: response.status,
    data: data as T,
    headers: response.headers,
  };
}

async function login(username: string): Promise<Client> {
  await Bun.sleep(250);
  const response = await fetch(`${origin}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username, password: "Test@1234" }),
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, 200, `Sign-in failed for fixture ${username}`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(
    cookie.includes("session_token"),
    "Sign-in must issue a session cookie"
  );
  await response.arrayBuffer();
  return { cookie, username };
}

async function check(name: string, execute: () => Promise<void>) {
  const started = performance.now();
  try {
    await execute();
    results.push({
      name,
      passed: true,
      durationMs: Math.round(performance.now() - started),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      error: message,
    });
    console.error(`FAIL ${name}: ${message}`);
  }
}

type EventStream = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
};

async function readStreamUntil(stream: EventStream, marker: string) {
  const decoder = new TextDecoder();
  while (!stream.buffer.includes(marker)) {
    const chunk = await stream.reader.read();
    assert.equal(
      chunk.done,
      false,
      "Event stream closed before the expected event"
    );
    stream.buffer += decoder.decode(chunk.value, { stream: true });
    assert.ok(
      stream.buffer.length <= 1024 * 1024,
      "Acceptance stream buffer exceeded its bound"
    );
  }
  const boundary = stream.buffer.indexOf(marker) + marker.length;
  stream.buffer = stream.buffer.slice(boundary);
}

async function withRoomStream(
  client: Client,
  roomId: string,
  after: string,
  execute: (stream: EventStream) => Promise<void>
) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(
      `${origin}${base}/rooms/${roomId}/events?after=${after}`,
      {
        headers: { cookie: client.cookie, origin },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
        ]),
      }
    );
    assert.equal(response.status, 200, "Authorized event stream must open");
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/u
    );
    assert.ok(response.body);
    reader = response.body.getReader();
    const stream = { reader, buffer: "" };
    await readStreamUntil(stream, "event: connected");
    await execute(stream);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
}

function send(
  client: Client | null,
  roomId: string,
  content = `Acceptance ${run}`,
  extra: Record<string, unknown> = {}
) {
  return request<MessageResult>(
    client,
    `${base}/rooms/${roomId}/messages`,
    "POST",
    { clientId: randomUUID(), content, ...extra }
  );
}

async function main() {
  const owner = await login("anny");
  const member = await login("communitychat_member");
  const moderator = await login("communitychat_mod");
  const invited = await login("communitychat_invited");
  const pending = await login("communitychat_pending");
  const timedout = await login("communitychat_timedout");
  console.log("Signed in all six fixture roles through the running app");

  await check("guest reads public history but cannot contribute", async () => {
    const history = await request<History>(
      null,
      `${base}/rooms/ccp_channel_general/messages`
    );
    assert.equal(history.status, 200);
    assert.equal(history.data.permissions.canRead, true);
    assert.equal(history.data.permissions.canSend, false);
    assert.match(history.headers.get("cache-control") ?? "", /no-store/u);
    assert.equal((await send(null, "ccp_channel_general")).status, 401);
  });
  await check(
    "pending and timed-out roles read with correct write restrictions",
    async () => {
      for (const [client, restriction] of [
        [pending, "PENDING"],
        [timedout, "TIMEOUT"],
      ] as const) {
        const history = await request<History>(
          client,
          `${base}/rooms/ccp_channel_general/messages`
        );
        assert.equal(history.status, 200);
        assert.equal(history.data.permissions.writeRestriction, restriction);
        assert.equal((await send(client, "ccp_channel_general")).status, 403);
      }
    }
  );
  await check(
    "announcement and locked channel restrictions are server-enforced",
    async () => {
      for (const [roomId, restriction] of [
        ["ccp_channel_announcements", "ANNOUNCEMENT"],
        ["ccp_channel_quiet_corner", "LOCKED"],
      ] as const) {
        const history = await request<History>(
          member,
          `${base}/rooms/${roomId}/messages`
        );
        assert.equal(history.data.permissions.writeRestriction, restriction);
        assert.equal((await send(member, roomId)).status, 403);
      }
      const staff = await request<History>(
        moderator,
        `${base}/rooms/ccp_channel_announcements/messages`
      );
      assert.equal(staff.data.permissions.canSend, true);
    }
  );
  await check(
    "private fixture hidden across history, threads, changes, pins and events",
    async () => {
      const privateRoom = "ccp_thread_small_group";
      for (const suffix of ["messages", "changes", "pins", "events"]) {
        assert.equal(
          (await request(member, `${base}/rooms/${privateRoom}/${suffix}`))
            .status,
          404
        );
      }
      const list = await request<{ threads: CommunityChatThreadSummary[] }>(
        member,
        `${base}/rooms/ccp_channel_general/threads`
      );
      assert.equal(list.status, 200);
      assert.equal(
        list.data.threads.some((thread) => thread.room.id === privateRoom),
        false
      );
      for (const client of [owner, moderator, invited]) {
        assert.equal(
          (await request(client, `${base}/rooms/${privateRoom}/messages`))
            .status,
          200
        );
      }
    }
  );
  await check(
    "member lookup is bounded and excludes pending applicants",
    async () => {
      const page = await request<{ members: { id: string }[] }>(
        member,
        `${base}/members?q=communitychat&limit=2`
      );
      assert.equal(page.status, 200);
      assert.ok(page.data.members.length <= 2);
      assert.equal(
        page.data.members.some((user) => user.id === "communitychat_pending"),
        false
      );
    }
  );

  const created = await request<{ channel: CommunityChatRoom }>(
    owner,
    `${base}/channels`,
    "POST",
    {
      channelType: "TEXT",
      name: `audit-${run}`,
      topic: "Disposable HTTP acceptance channel",
    }
  );
  assert.equal(created.status, 201, "Owner must create an acceptance channel");
  const roomId = created.data.channel.id;
  try {
    await check(
      "members cannot create channels; staff can rename and order",
      async () => {
        assert.equal(
          (
            await request(member, `${base}/channels`, "POST", {
              channelType: "TEXT",
              name: `denied-${run}`,
            })
          ).status,
          403
        );
        const updated = await request<{ channel: CommunityChatRoom }>(
          moderator,
          `${base}/channels/${roomId}`,
          "PATCH",
          {
            name: `verified-${run}`,
            topic: "Verified staff topic",
            sortOrder: 99,
          }
        );
        assert.equal(updated.status, 200);
        assert.equal(updated.data.channel.sortOrder, 99);
        assert.equal(updated.data.channel.topic, "Verified staff topic");
      }
    );
    await check(
      "validates malformed, empty and oversized message bodies",
      async () => {
        assert.equal(
          (await send(member, roomId, "")).status,
          400,
          "Empty message should return 400"
        );
        assert.equal(
          (await send(member, roomId, "x".repeat(4001))).status,
          400,
          "Oversized message should return 400"
        );
        assert.equal(
          (
            await request(
              member,
              `${base}/rooms/${roomId}/messages`,
              "POST",
              []
            )
          ).status,
          400,
          "Array body should return 400"
        );
      }
    );
    let message: CommunityChatMessage | undefined;
    await check(
      "concurrent retry IDs produce one message and monotonic string sequences",
      async () => {
        const clientId = randomUUID();
        const responses = await Promise.all([
          send(member, roomId, `Acceptance ${run}`, { clientId }),
          send(member, roomId, `Acceptance ${run}`, { clientId }),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [200, 201]
        );
        assert.equal(
          responses[0]?.data.message.id,
          responses[1]?.data.message.id
        );
        message = responses[0]?.data.message;
        assert.ok(message);
        assert.match(message.sequence, /^[0-9]+$/u);
        const history = await request<History>(
          member,
          `${base}/rooms/${roomId}/messages`
        );
        assert.equal(history.data.messages.length, 1);
      }
    );
    await check(
      "reply context, edits, stale revisions, reactions and pins survive HTTP hydration",
      async () => {
        assert.ok(message);
        const reply = await send(invited, roomId, "Acceptance reply", {
          replyToId: message.id,
        });
        assert.equal(reply.status, 201);
        assert.equal(reply.data.message.replyTo?.id, message.id);
        assert.equal(
          (
            await request(owner, `${base}/messages/${message.id}`, "PATCH", {
              revision: 1,
              content: "Staff cannot edit another sender",
            })
          ).status,
          403
        );
        const edit = await request<MessageResult>(
          member,
          `${base}/messages/${message.id}`,
          "PATCH",
          { revision: 1, content: "Acceptance edited" }
        );
        assert.equal(edit.status, 200);
        assert.equal(edit.data.message.revision, 2);
        assert.equal(
          (
            await request(member, `${base}/messages/${message.id}`, "PATCH", {
              revision: 1,
              content: "Stale edit",
            })
          ).status,
          409
        );
        assert.equal(
          (
            await request(
              invited,
              `${base}/rooms/${roomId}/reactions`,
              "POST",
              { messageId: message.id, emoji: "🌿", reacted: true }
            )
          ).status,
          200
        );
        assert.equal(
          (
            await request(
              pending,
              `${base}/rooms/${roomId}/reactions`,
              "POST",
              { messageId: message.id, emoji: "🌿", reacted: true }
            )
          ).status,
          403
        );
        assert.equal(
          (
            await request(member, `${base}/rooms/${roomId}/pins`, "PATCH", {
              messageId: message.id,
              pinned: true,
            })
          ).status,
          403
        );
        assert.equal(
          (
            await request(moderator, `${base}/rooms/${roomId}/pins`, "PATCH", {
              messageId: message.id,
              pinned: true,
            })
          ).status,
          200
        );
        const pins = await request<{ messages: CommunityChatMessage[] }>(
          member,
          `${base}/rooms/${roomId}/pins`
        );
        assert.equal(pins.data.messages[0]?.reactions?.[0]?.count, 1);
      }
    );
    await check(
      "public thread remains readable after its source becomes a tombstone",
      async () => {
        assert.ok(message);
        const createdThread = await request<{ thread: CommunityChatRoom }>(
          member,
          `${base}/rooms/${roomId}/threads`,
          "POST",
          {
            clientId: randomUUID(),
            name: `Public acceptance ${run}`,
            sourceMessageId: message.id,
            visibility: "PUBLIC",
          }
        );
        assert.equal(createdThread.status, 201);
        const threadId = createdThread.data.thread.id;
        assert.equal(
          (await send(invited, threadId, "A thread-only reply")).status,
          201
        );
        assert.equal(
          (
            await request(
              moderator,
              `${base}/messages/${message.id}`,
              "DELETE",
              { revision: 2 }
            )
          ).status,
          200
        );
        assert.equal(
          (await request(null, `${base}/rooms/${threadId}/messages`)).status,
          200
        );
        const tombstone = await request<MessageResult>(
          member,
          `${base}/rooms/${roomId}/messages/${message.id}`
        );
        assert.equal(tombstone.data.message.payload, null);
        assert.ok(tombstone.data.message.deletedAt);
        assert.equal(
          (
            await request(member, `${base}/rooms/${roomId}/reactions`, "POST", {
              messageId: message.id,
              emoji: "🌿",
              reacted: true,
            })
          ).status,
          404
        );
      }
    );
    await check(
      "private thread invitation grants and revokes access without channel leakage",
      async () => {
        const createdThread = await request<{ thread: CommunityChatRoom }>(
          owner,
          `${base}/rooms/${roomId}/threads`,
          "POST",
          {
            clientId: randomUUID(),
            name: `Private acceptance ${run}`,
            starterContent: "Private acceptance starter",
            visibility: "PRIVATE",
            inviteeUserIds: ["communitychat_invited"],
          }
        );
        assert.equal(createdThread.status, 201);
        const threadId = createdThread.data.thread.id;
        assert.equal(
          (await request(invited, `${base}/rooms/${threadId}/messages`)).status,
          200
        );
        assert.equal(
          (await request(member, `${base}/rooms/${threadId}/messages`)).status,
          404
        );
        assert.equal(
          (
            await request(
              owner,
              `${base}/threads/${threadId}/invitations`,
              "DELETE",
              { userIds: ["communitychat_invited"] }
            )
          ).status,
          204
        );
        assert.equal(
          (await request(invited, `${base}/rooms/${threadId}/messages`)).status,
          404
        );
        assert.equal(
          (
            await request(
              owner,
              `${base}/threads/${threadId}/invitations`,
              "POST",
              { userIds: ["communitychat_invited"] }
            )
          ).status,
          204
        );
        assert.equal(
          (
            await request(
              invited,
              `${base}/threads/${threadId}/following`,
              "PATCH",
              { following: false }
            )
          ).status,
          200
        );
        assert.equal(
          (
            await request(
              invited,
              `${base}/threads/${threadId}/following`,
              "PATCH",
              { following: true }
            )
          ).status,
          200
        );
        const channelHistory = await request<History>(
          member,
          `${base}/rooms/${roomId}/messages`
        );
        assert.equal(
          channelHistory.data.messages.some(
            (row) =>
              row.payload?.type === "text" &&
              row.payload.content.includes("Private acceptance")
          ),
          false
        );
        assert.equal(
          (
            await request(moderator, `${base}/threads/${threadId}`, "PATCH", {
              locked: true,
            })
          ).status,
          200
        );
        assert.equal((await send(invited, threadId)).status, 403);
        assert.equal(
          (
            await request(owner, `${base}/threads/${threadId}`, "PATCH", {
              archived: true,
            })
          ).status,
          200
        );
      }
    );
    await check(
      "read watermarks and mute preferences persist privately",
      async () => {
        const history = await request<History>(
          member,
          `${base}/rooms/${roomId}/messages`
        );
        assert.equal(
          (
            await request(member, `${base}/rooms/${roomId}/read`, "POST", {
              readSequence: history.data.room.nextSequence,
            })
          ).status,
          200
        );
        const original = await request<{ muted: boolean }>(
          member,
          `${base}/preferences`
        );
        try {
          const muted = await request<{ muted: boolean }>(
            member,
            `${base}/preferences`,
            "PATCH",
            { muted: true }
          );
          assert.equal(muted.status, 200);
          assert.equal(muted.data.muted, true);
        } finally {
          await request(member, `${base}/preferences`, "PATCH", {
            muted: original.data.muted,
          });
        }
      }
    );
    await check(
      "live SSE delivers a committed message and replays it after reconnect",
      async () => {
        const history = await request<History>(
          member,
          `${base}/rooms/${roomId}/messages`
        );
        const cursor = history.data.room.changeSequence;
        let liveId = "";
        await withRoomStream(member, roomId, cursor, async (stream) => {
          const sent = await send(owner, roomId, "Realtime acceptance");
          assert.equal(sent.status, 201);
          liveId = sent.data.message.id;
          await readStreamUntil(stream, liveId);
        });
        const replay = await request<{ changes: { messageId: string }[] }>(
          member,
          `${base}/rooms/${roomId}/changes?after=${cursor}`
        );
        assert.equal(replay.status, 200);
        assert.ok(
          replay.data.changes.some((change) => change.messageId === liveId)
        );
        await withRoomStream(member, roomId, cursor, (stream) =>
          readStreamUntil(stream, liveId)
        );
      }
    );
    await check(
      "open private stream revokes an invitation within its authorization lease",
      async () => {
        const createdThread = await request<{ thread: CommunityChatRoom }>(
          owner,
          `${base}/rooms/${roomId}/threads`,
          "POST",
          {
            clientId: randomUUID(),
            name: `Lease acceptance ${run}`,
            starterContent: "Lease acceptance starter",
            visibility: "PRIVATE",
            inviteeUserIds: ["communitychat_invited"],
          }
        );
        assert.equal(createdThread.status, 201);
        const threadId = createdThread.data.thread.id;
        await withRoomStream(invited, threadId, "0", async (stream) => {
          const removed = await request(
            owner,
            `${base}/threads/${threadId}/invitations`,
            "DELETE",
            { userIds: ["communitychat_invited"] }
          );
          assert.equal(removed.status, 204);
          const started = performance.now();
          await readStreamUntil(stream, "event: access-revoked");
          assert.ok(
            performance.now() - started <= 6000,
            "Revocation exceeded five-second lease plus one-second transport allowance"
          );
        });
        assert.equal(
          (await request(invited, `${base}/rooms/${threadId}/messages`)).status,
          404
        );
      }
    );
    await check(
      "slow mode serializes concurrent sends and archive blocks new writes",
      async () => {
        assert.equal(
          (
            await request(owner, `${base}/channels/${roomId}`, "PATCH", {
              slowModeSeconds: 60,
            })
          ).status,
          200
        );
        const responses = await Promise.all([
          send(moderator, roomId),
          send(moderator, roomId),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [201, 429]
        );
        assert.equal(
          (
            await request(owner, `${base}/channels/${roomId}`, "PATCH", {
              archived: true,
            })
          ).status,
          200
        );
        assert.equal((await send(member, roomId)).status, 403);
      }
    );
  } finally {
    await request(owner, `${base}/channels/${roomId}`, "PATCH", {
      archived: true,
    });
  }
}

try {
  await main();
} catch (error) {
  results.push({
    name: "acceptance setup",
    passed: false,
    durationMs: 0,
    error: error instanceof Error ? error.message : String(error),
  });
} finally {
  const summary = {
    executedAt: new Date().toISOString(),
    origin,
    run,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };
  await Bun.write(
    "audits/community-chat-http-acceptance.json",
    `${JSON.stringify(summary, null, 2)}\n`
  );
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failed > 0 ? 1 : 0;
}
