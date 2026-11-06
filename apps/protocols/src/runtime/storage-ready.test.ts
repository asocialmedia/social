import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { waitForStorageReady } from "./storage-ready";

test("workers wait for writable Redis without leaving listeners after ready or shutdown", async () => {
  // oxlint-disable-next-line unicorn/prefer-event-target -- ioredis implements the Node EventEmitter contract.
  const connection = Object.assign(new EventEmitter(), {
    status: "connecting",
  });
  const abort = new AbortController();
  let started = false;
  const waiting = waitForStorageReady(connection, abort.signal).then(
    (ready) => {
      started = ready;
    }
  );
  await Promise.resolve();
  expect(started).toBe(false);
  connection.status = "ready";
  connection.emit("ready");
  await waiting;
  expect(started).toBe(true);
  expect(connection.listenerCount("ready")).toBe(0);
  connection.status = "reconnecting";
  const stopping = waitForStorageReady(connection, abort.signal);
  abort.abort();
  expect(await stopping).toBe(false);
  expect(connection.listenerCount("ready")).toBe(0);
});
