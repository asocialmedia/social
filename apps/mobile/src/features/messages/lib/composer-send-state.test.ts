import { expect, test } from "bun:test";

import {
  beginSend,
  canStartSend,
  failSend,
  idleSendState,
  isCurrentSend,
} from "./composer-send-state";

test("idle and failed sends may start, in-flight sends may not", () => {
  expect(canStartSend(idleSendState())).toBe(true);
  expect(canStartSend(failSend("a", "boom"))).toBe(true);
  expect(canStartSend({ clientId: "a", kind: "sending" })).toBe(false);
});

test("beginSend moves idle and failed into sending with the new client id", () => {
  expect(beginSend(idleSendState(), "a")).toEqual({
    clientId: "a",
    kind: "sending",
  });
  expect(beginSend(failSend("old", "boom"), "next")).toEqual({
    clientId: "next",
    kind: "sending",
  });
});

test("beginSend throws while a send is in flight instead of double-sending", () => {
  expect(() => beginSend({ clientId: "a", kind: "sending" }, "b")).toThrow();
});

test("isCurrentSend ignores stale settles from a previous attempt", () => {
  expect(isCurrentSend(idleSendState(), "a")).toBe(false);
  expect(isCurrentSend({ clientId: "a", kind: "sending" }, "a")).toBe(true);
  expect(isCurrentSend({ clientId: "a", kind: "sending" }, "b")).toBe(false);
  expect(isCurrentSend(failSend("a", "boom"), "b")).toBe(false);
});
