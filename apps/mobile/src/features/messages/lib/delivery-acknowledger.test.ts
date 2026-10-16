import { expect, test } from "bun:test";

import { DeliveryAcknowledger } from "./delivery-acknowledger";

const message = (id: string, second: number, senderId = "peer") => ({
  createdAt: new Date(second * 1000).toISOString(),
  id,
  senderId,
});
test("delivery coalesces arrivals, excludes own messages and never moves backwards", async () => {
  const calls: string[] = [];
  const delivery = new DeliveryAcknowledger(async (_conversationId, id) => {
    calls.push(id);
    await Bun.sleep(5);
  });
  const first = delivery.receive("thread", message("first", 1), "me");
  const next = delivery.receive("thread", message("latest", 3), "me");
  await Promise.all([
    first,
    next,
    delivery.receive("thread", message("mine", 9, "me"), "me"),
  ]);
  await delivery.receive("thread", message("older", 2), "me");
  expect(calls).toEqual(["latest"]);
});
test("an arrival during delivery is acknowledged and a failed acknowledgement retries", async () => {
  const calls: string[] = [];
  let fail = true;
  const delivery = new DeliveryAcknowledger(async (_conversationId, id) => {
    calls.push(id);
    await Bun.sleep(5);
    if (fail) {
      throw new Error("Offline");
    }
  });
  await delivery.receive("thread", message("first", 1), "me");
  fail = false;
  const pending = delivery.receive("thread", message("first", 1), "me");
  await Bun.sleep(1);
  await delivery.receive("thread", message("latest", 2), "me");
  await pending;
  expect(calls).toEqual(["first", "first", "latest"]);
});
