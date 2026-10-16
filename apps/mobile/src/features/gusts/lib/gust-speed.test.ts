import { expect, test } from "bun:test";

import {
  createGustSpeedHold,
  GUST_SPEED_HOLD_MS,
} from "@asm/ui/lib/gust-speed";

function fixture() {
  const changes: boolean[] = [];
  let consumed = 0;
  const hold = createGustSpeedHold({
    onChange: (active) => changes.push(active),
    onConsumeTap: () => {
      consumed += 1;
    },
  });
  return { changes, consumed: () => consumed, hold };
}

test("a quick tap never changes playback speed or consumes the tap", async () => {
  const f = fixture();
  f.hold.start(100, 200);
  f.hold.cancel();
  await Bun.sleep(GUST_SPEED_HOLD_MS + 30);
  expect(f.changes).toEqual([]);
  expect(f.consumed()).toBe(0);
});

test("holding boosts once and release resets once without a trailing playback tap", async () => {
  const f = fixture();
  f.hold.start(100, 200);
  await Bun.sleep(GUST_SPEED_HOLD_MS + 30);
  expect(f.changes).toEqual([true]);
  expect(f.consumed()).toBe(1);
  f.hold.cancel();
  f.hold.cancel();
  expect(f.changes).toEqual([true, false]);
  expect(f.consumed()).toBe(2);
});

test("paging before the threshold cancels the pending boost", async () => {
  const f = fixture();
  f.hold.start(100, 200);
  f.hold.move(100, 180);
  await Bun.sleep(GUST_SPEED_HOLD_MS + 30);
  expect(f.changes).toEqual([]);
});

test("small finger jitter keeps the hold while deliberate movement restores normal speed", async () => {
  const f = fixture();
  f.hold.start(100, 200);
  f.hold.move(103, 204);
  await Bun.sleep(GUST_SPEED_HOLD_MS + 30);
  expect(f.changes).toEqual([true]);
  f.hold.move(100, 230);
  expect(f.changes).toEqual([true, false]);
});

test("starting a new hold clears the old timer and cancellation never leaves a delayed boost", async () => {
  const f = fixture();
  f.hold.start(100, 200);
  f.hold.start(120, 200);
  f.hold.cancel();
  await Bun.sleep(GUST_SPEED_HOLD_MS + 30);
  expect(f.changes).toEqual([]);
});
