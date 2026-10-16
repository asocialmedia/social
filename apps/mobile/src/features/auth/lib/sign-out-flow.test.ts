// oxlint-disable require-await -- Async fakes implement the native adapters Promise contracts.
import { describe, expect, test } from "bun:test";

import { runSignOutFlow } from "./sign-out-flow";

describe("native logout", () => {
  test("opens login before waiting for the network and keeps the cookie until push unregisters", async () => {
    const events: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const flight = runSignOutFlow({
      clear: () => {
        events.push("clear");
      },
      complete: () => {
        events.push("complete");
      },
      navigate: () => {
        events.push("login");
      },
      revoke: async () => {
        events.push("revoke");
      },
      unregister: async () => {
        events.push("unregister");
        await gate.promise;
      },
    });
    expect(events).toEqual(["login", "unregister"]);
    gate.resolve();
    await flight;
    expect(events).toEqual([
      "login",
      "unregister",
      "revoke",
      "clear",
      "complete",
    ]);
  });

  test("clears viewer state and unlocks login after a revoke failure", async () => {
    const events: string[] = [];
    await expect(
      runSignOutFlow({
        clear: () => {
          events.push("clear");
        },
        complete: () => {
          events.push("complete");
        },
        navigate: () => {
          events.push("login");
        },
        revoke: async () => {
          throw new Error("offline");
        },
        unregister: async () => {},
      })
    ).rejects.toThrow("offline");
    expect(events).toEqual(["login", "clear", "complete"]);
  });
});
