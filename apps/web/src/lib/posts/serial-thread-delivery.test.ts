import { expect, mock, test } from "bun:test";

import { serialThreadDelivery } from "./serial-thread-delivery";

test("a slow create policy check cannot arrive after its later deletion", async () => {
  const gate = Promise.withResolvers<undefined>();
  const delivered: string[] = [];
  const receive = serialThreadDelivery(async (message) => {
    if (message === "create") {
      await gate.promise;
    }
    delivered.push(message);
  }, mock());
  const created = receive("create");
  const deleted = receive("delete");
  await Promise.resolve();
  expect(delivered).toEqual([]);
  gate.resolve();
  await Promise.all([created, deleted]);
  expect(delivered).toEqual(["create", "delete"]);
});

test("a slow listener disconnects on overflow and drops its queued events", async () => {
  const close = mock();
  const deliver = mock(() => Promise.resolve());
  const receive = serialThreadDelivery(deliver, close, 2);
  await Promise.all([receive("one"), receive("two"), receive("overflow")]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(deliver).not.toHaveBeenCalled();
  await receive("after-close");
  expect(deliver).not.toHaveBeenCalled();
});
