import assert from "node:assert/strict";

import { loadRootEnv } from "../src/load-env";

loadRootEnv();
const { clefSafetyVerdict, evaluateClef } = await import("../src/analyze/clef");
const { closeQueueConnections, redis } = await import("@asm/db");
const realFetch = globalThis.fetch;
let providerRequests = 0;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  providerRequests += 1;
  return await realFetch(...args);
}) as typeof fetch;
try {
  const input = {
    text: `A nonsexual anime illustration of an adult character hiking in the mountains. Test ${crypto.randomUUID()}`,
  };
  const decision = await evaluateClef(input);
  assert.equal(clefSafetyVerdict(decision).explicit, false);
  assert.ok(decision.tags.includes("anime"));
  const cached = await evaluateClef(input);
  assert.deepEqual(cached, decision);
  assert.equal(providerRequests, 1);
  let imageEvaluated = false;
  if (process.argv[2]) {
    const imageDecision = await evaluateClef({
      imagePath: process.argv[2],
      text: "Synthetic codec test image, no sexual content",
    });
    assert.equal(clefSafetyVerdict(imageDecision).explicit, false);
    imageEvaluated = true;
  }
  console.log(
    JSON.stringify({
      cached: true,
      explicit: false,
      imageEvaluated,
      model: decision.policyVersion,
      providerRequests,
      tags: decision.tags,
    })
  );
} finally {
  globalThis.fetch = realFetch;
  await closeQueueConnections();
  redis.disconnect();
}
