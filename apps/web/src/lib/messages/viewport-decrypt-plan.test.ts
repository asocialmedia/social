import { expect, test } from "bun:test";

import { viewportDecryptPlan } from "./viewport-decrypt-plan";

test("large viewport keeps prefetch outside the urgent lane and ignores permanent notice ids", () => {
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: String(index),
  }));
  const visible = messages.slice(100, 200).map((message) => message.id);
  const plan = viewportDecryptPlan(
    messages,
    ["incognito-notice", ...visible],
    64
  );
  expect(plan.urgent.map((message) => message.id)).toEqual(visible);
  expect(plan.prefetch).toHaveLength(128);
  expect(plan.prefetch.some((message) => visible.includes(message.id))).toBe(
    false
  );
  expect(plan.urgent).toHaveLength(100);
});
