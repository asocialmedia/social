import { expect, test } from "bun:test";

import { loadCommunityChatResources } from "./chat-loading";

function deferredResponse() {
  const { promise, resolve } = Promise.withResolvers<Response>();
  return { complete: resolve, promise };
}

test("history becomes available while a slow thread request is still pending", async () => {
  const history = deferredResponse();
  const threads = deferredResponse();
  const delivered: string[] = [];
  const tasks = loadCommunityChatResources<
    { message: string },
    { thread: string }
  >(
    {
      messagesUrl: "/messages",
      onHistory: (page) => delivered.push(page.message),
      onHistoryError: () => delivered.push("history-error"),
      onThreads: (page) => delivered.push(page.thread),
      onThreadsError: () => delivered.push("threads-error"),
      signal: new AbortController().signal,
      threadsUrl: "/threads",
    },
    (url) => (url === "/messages" ? history.promise : threads.promise)
  );
  history.complete(Response.json({ message: "history" }));
  await tasks.history;
  expect(delivered).toEqual(["history"]);
  threads.complete(new Response(null, { status: 503 }));
  await tasks.threads;
  expect(delivered).toEqual(["history", "threads-error"]);
});

test("leaving a room suppresses late history and thread responses", async () => {
  const pending = deferredResponse();
  const controller = new AbortController();
  let delivered = 0;
  const record = () => {
    delivered += 1;
  };
  const tasks = loadCommunityChatResources(
    {
      messagesUrl: "/messages",
      onHistory: record,
      onHistoryError: record,
      onThreads: record,
      onThreadsError: record,
      signal: controller.signal,
      threadsUrl: "/threads",
    },
    () => pending.promise
  );
  controller.abort();
  pending.complete(Response.json({}));
  await Promise.all([tasks.history, tasks.threads]);
  expect(delivered).toBe(0);
});

test("denied history stays unavailable even when thread metadata succeeds", async () => {
  let deniedStatus: number | undefined;
  const delivered: string[] = [];
  const tasks = loadCommunityChatResources(
    {
      messagesUrl: "/messages",
      onHistory: () => delivered.push("history"),
      onHistoryError: (status) => {
        deniedStatus = status;
        delivered.push("denied");
      },
      onThreads: () => delivered.push("threads"),
      onThreadsError: () => delivered.push("threads-error"),
      signal: new AbortController().signal,
      threadsUrl: "/threads",
    },
    (url) =>
      url === "/messages"
        ? new Response(null, { status: 404 })
        : Response.json({})
  );
  await Promise.all([tasks.history, tasks.threads]);
  expect(delivered).toContain("denied");
  expect(deniedStatus).toBe(404);
  expect(delivered).toContain("threads");
  expect(delivered).not.toContain("history");
});

test("an abandoned mount never starts its history or thread requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  let callbacks = 0;
  const ignore = () => {
    callbacks += 1;
  };
  const tasks = loadCommunityChatResources(
    {
      messagesUrl: "/messages",
      onHistory: ignore,
      onHistoryError: ignore,
      onThreads: ignore,
      onThreadsError: ignore,
      signal: controller.signal,
      threadsUrl: "/threads",
    },
    () => {
      requests += 1;
      return Response.json({});
    }
  );
  await Promise.all([tasks.history, tasks.threads]);
  expect(requests).toBe(0);
  expect(callbacks).toBe(0);
});
