import { describe, expect, test } from "bun:test";

import {
  fetchIdentity,
  fetchMessages,
  fetchUnreadMessageCount,
} from "./client";
import { HistoryThrottledError } from "./history-throttle";

describe("message reads", () => {
  test("overlapping identity reads share transport but each receives parsed JSON", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        await Bun.sleep(5);
        return Response.json({ identity: null });
      },
      { preconnect: fetch.preconnect }
    );
    const options = {
      apiBase: "https://messages.invalid",
      baseFetch,
      cookie: "session_token=one",
    };
    const results = await Promise.all([
      fetchIdentity(options),
      fetchIdentity(options),
    ]);
    expect(calls).toBe(1);
    expect(results).toEqual([{ identity: null }, { identity: null }]);
  });
  test("account credentials isolate overlapping identity reads", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        await Bun.sleep(5);
        return Response.json({ identity: null });
      },
      { preconnect: fetch.preconnect }
    );
    await Promise.all(
      ["one", "two"].map((token) =>
        fetchIdentity({
          apiBase: "https://messages.invalid",
          baseFetch,
          cookie: `session_token=${token}`,
        })
      )
    );
    expect(calls).toBe(2);
  });
  test("a throttle preserves the server retry delay and releases the shared GET", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? Response.json(
                { error: "rate limited" },
                { headers: { "retry-after": "60" }, status: 429 }
              )
            : Response.json({ identity: null })
        );
      },
      { preconnect: fetch.preconnect }
    );
    const options = { apiBase: "https://messages.invalid", baseFetch };
    try {
      await fetchIdentity(options);
      throw new Error("Expected a throttle");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryThrottledError);
      if (error instanceof HistoryThrottledError) {
        expect(error.retryAfterSeconds).toBe(60);
      }
    }
    expect(await fetchIdentity(options)).toEqual({ identity: null });
    expect(calls).toBe(2);
  });
});

test("cancelling a history read still aborts its own transport", async () => {
  const controller = new AbortController();
  let transportAborted = false;
  const baseFetch: typeof fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      // oxlint-disable-next-line promise/avoid-new -- this transport stays pending until its abort signal rejects it
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            transportAborted = true;
            reject(
              Object.assign(new Error("Cancelled history read"), {
                name: "AbortError",
              })
            );
          },
          { once: true }
        );
      }),
    { preconnect: fetch.preconnect }
  );
  const pending = fetchMessages(
    "conversation",
    undefined,
    {
      apiBase: "https://messages.invalid",
      baseFetch,
    },
    30,
    { signal: controller.signal }
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(transportAborted).toBe(true);
});

test("a failed unread-count request cannot masquerade as an authoritative zero badge", async () => {
  const baseFetch: typeof fetch = Object.assign(
    () =>
      Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 })),
    { preconnect: fetch.preconnect }
  );
  await expect(
    fetchUnreadMessageCount({ apiBase: "https://messages.invalid", baseFetch })
  ).rejects.toMatchObject({ status: 503 });
});

test("empty successful mutations do not throw JSON parse errors", async () => {
  const { ackMessageDelivered, leaveDen } = await import("./client");
  const options = {
    apiBase: "https://messages.invalid",
    baseFetch: Object.assign(
      () => Promise.resolve(new Response(null, { status: 204 })),
      { preconnect: fetch.preconnect }
    ),
  };
  await expect(
    ackMessageDelivered("den", "message", options)
  ).resolves.toBeUndefined();
  await expect(leaveDen("den", options)).resolves.toBeUndefined();
});

test("new native calls preserve server search revisions and wrapper metadata", async () => {
  const {
    searchConversationHistory,
    hydrateSearchHits,
    postConversationKeys,
    createDen,
    fetchSharedConversationItems,
  } = await import("./client");
  const requests: { url: string; init?: RequestInit }[] = [];
  const options = {
    apiBase: "https://messages.invalid",
    baseFetch: Object.assign(
      (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ init, url: String(url) });
        return Promise.resolve(Response.json({ applied: 1 }));
      },
      { preconnect: fetch.preconnect }
    ),
  };
  await searchConversationHistory(
    "room",
    { cursor: "opaque cursor", query: "two words" },
    options
  );
  await hydrateSearchHits("room", [{ id: "message", revision: 4 }], options);
  await postConversationKeys(
    "room",
    [
      {
        encryptedKey: { ciphertext: "cipher", iv: "iv" },
        ownerUserId: "owner",
        version: 2,
        wrapperPublicKey: "snapshot",
        wrapperUserId: "author",
      },
    ],
    options
  );
  await createDen({ memberIds: ["peer"], name: "Room" }, options);
  await fetchSharedConversationItems("room", "media", options, "next cursor");
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({
    cursor: "opaque cursor",
    query: "two words",
  });
  expect(JSON.parse(String(requests[1].init?.body))).toEqual({
    messages: [{ id: "message", revision: 4 }],
  });
  expect(JSON.parse(String(requests[2].init?.body)).keys[0]).toMatchObject({
    version: 2,
    wrapperPublicKey: "snapshot",
    wrapperUserId: "author",
  });
  expect(JSON.parse(String(requests[3].init?.body))).toMatchObject({
    memberIds: ["peer"],
    type: "DEN",
  });
  expect(requests[4].url).toBe(
    "https://messages.invalid/api/messages/conversations/room/shared?kind=media&limit=20&cursor=next+cursor"
  );
});

test("an empty server search page does not issue a rejected empty batch request", async () => {
  const { hydrateSearchHits } = await import("./client");
  let requests = 0;
  const result = await hydrateSearchHits("chat", [], {
    apiBase: "https://api.example",
    baseFetch: Object.assign(
      () => {
        requests += 1;
        throw new Error("No request should be sent");
      },
      { preconnect: fetch.preconnect }
    ),
  });
  expect(result).toEqual({ deferredIds: [], messages: [], unavailableIds: [] });
  expect(requests).toBe(0);
});

test("Den management keeps member authority on the server and encodes removal paths", async () => {
  const { changeDenMember, renewDenInvite, dissolveDen } =
    await import("./client");
  const calls: {
    url: string;
    method: string | undefined;
    body: unknown;
    cookie: string | null;
  }[] = [];
  const baseFetch: typeof fetch = Object.assign(
    (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        cookie: new Headers(init?.headers).get("cookie"),
        method: init?.method,
        url: String(url),
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
    { preconnect: fetch.preconnect }
  );
  const options = {
    apiBase: "https://messages.invalid",
    baseFetch,
    cookie: "session_token=fixture",
  };
  await changeDenMember(
    "room",
    { action: "add", userId: "new-member" },
    options
  );
  await changeDenMember(
    "room",
    { action: "promote", userId: "member" },
    options
  );
  await changeDenMember(
    "room",
    { action: "demote", userId: "member" },
    options
  );
  await changeDenMember(
    "room",
    { action: "transfer", userId: "member" },
    options
  );
  await changeDenMember(
    "room",
    { action: "remove", userId: "member/one" },
    options
  );
  await changeDenMember("room", { action: "ban", userId: "member" }, options);
  await changeDenMember(
    "room",
    { action: "unban", userId: "member/one" },
    options
  );
  await renewDenInvite("room", "code", 7, options);
  await dissolveDen("room", options);
  expect(calls[0].body).toEqual({ memberIds: ["new-member"] });
  expect(calls[1].body).toEqual({ role: "ADMIN", userId: "member" });
  expect(calls[2].body).toEqual({ role: "MEMBER", userId: "member" });
  expect(calls[3].url).toEndWith("/transfer");
  expect(calls[4].url).toEndWith("/members/member%2Fone");
  expect(calls[4].method).toBe("DELETE");
  expect(calls[5].url).toEndWith("/bans");
  expect(calls[6].url).toEndWith("/bans/member%2Fone");
  expect(calls[7].body).toEqual({ durationDays: 7 });
  expect(calls[8].method).toBe("DELETE");
  expect(calls.every((call) => call.cookie === "session_token=fixture")).toBe(
    true
  );
});
