import { expect, test } from "bun:test";

import { MessagesApiError, sendEncryptedMessage } from "./client";
import { decryptMessage, generateRootKey } from "./crypto";
import type { EncryptedMessage } from "./crypto";

function transport(reply: (body: EncryptedMessage) => Response): typeof fetch {
  return Object.assign(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        reply(JSON.parse(String(init?.body)) as EncryptedMessage)
      ),
    { preconnect: fetch.preconnect }
  );
}

test("a paged or stale transcript retries at the server index and the peer can decrypt", async () => {
  const key = generateRootKey();
  const requests: EncryptedMessage[] = [];
  const baseFetch = transport((body) => {
    requests.push(body);
    return body.ratchetIndex === 73
      ? Response.json(
          { message: { id: "acknowledged", ...body } },
          { status: 201 }
        )
      : Response.json(
          { error: "ratchet index mismatch", expectedIndex: 73 },
          { status: 409 }
        );
  });
  const sent = await sendEncryptedMessage(
    "thread",
    key,
    "sender",
    2,
    { content: "Retain this draft until acknowledged", type: "text" },
    { apiBase: "https://messages.invalid", baseFetch }
  );
  expect(sent.id).toBe("acknowledged");
  expect(requests.map((row) => row.ratchetIndex)).toEqual([2, 73]);
  const [, retried] = requests;
  if (!retried) {
    throw new Error("Expected a retried ciphertext");
  }
  expect(await decryptMessage(key, "sender", "thread", retried)).toEqual({
    content: "Retain this draft until acknowledged",
    type: "text",
  });
});

test("exhausted conflicts reject instead of clearing an unsent draft", async () => {
  let calls = 0;
  const baseFetch = transport(() => {
    calls += 1;
    return Response.json(
      { error: "conflict", expectedIndex: calls + 50 },
      { status: 409 }
    );
  });
  await expect(
    sendEncryptedMessage(
      "thread",
      generateRootKey(),
      "sender",
      0,
      { content: "Keep me", type: "text" },
      { apiBase: "https://messages.invalid", baseFetch }
    )
  ).rejects.toBeInstanceOf(MessagesApiError);
  expect(calls).toBe(3);
});

test("a missing acknowledgement or a blocked send is never treated as success", async () => {
  for (const response of [
    Response.json({ message: null }, { status: 201 }),
    Response.json({ error: "Blocked" }, { status: 403 }),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each independent server failure must reject
    await expect(
      sendEncryptedMessage(
        "thread",
        generateRootKey(),
        "sender",
        0,
        { content: "Keep me", type: "text" },
        {
          apiBase: "https://messages.invalid",
          baseFetch: transport(() => response),
        }
      )
    ).rejects.toBeInstanceOf(Error);
  }
});
