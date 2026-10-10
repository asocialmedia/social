import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import {
  AUTO_COLLAPSE_DELAY,
  AUTO_EXPAND_DELAY,
  DEFAULT_DURATION,
  EXIT_DURATION,
} from "./internal";
import {
  createToast,
  dismissToast,
  isTimedDuration,
  setDefaultPosition,
  store,
  timeoutKey,
  updateToast,
} from "./store";
import type { ToastRecord } from "./store";
import { TOAST_POSITIONS } from "./types";

// The store is a module singleton, mirroring upstream's, so every test starts
// from an empty stack with default configuration. Exit timers are keyed by
// `id:instanceId`, so ids are unique per test and no timer leaks across.
beforeEach(() => {
  store.update(() => []);
  store.options = undefined;
  store.position = "top-right";
});

afterEach(() => {
  store.update(() => []);
  store.options = undefined;
  store.position = "top-right";
});

const ids = (): string[] => store.toasts.map((item) => item.id);

const only = (): ToastRecord => {
  expect(store.toasts).toHaveLength(1);
  const [record] = store.toasts;
  expect(record).toBeDefined();
  return record as ToastRecord;
};

describe("createToast", () => {
  test("returns the caller's id when one is given", () => {
    expect(createToast({ id: "save", title: "Saved" })).toBe("save");
    expect(ids()).toEqual(["save"]);
  });

  test("generates an id when none is given", () => {
    const id = createToast({ title: "Saved" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(ids()).toEqual([id]);
  });

  test("generated ids are unique across calls", () => {
    const generated = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      generated.add(createToast({ title: "t" }));
    }
    expect(generated.size).toBe(50);
  });

  test("a fresh record is not exiting and carries the caller's options", () => {
    createToast({ description: "body", fill: "#123456", id: "a", title: "T" });
    const record = only();
    expect(record.exiting).toBe(false);
    expect(record.title).toBe("T");
    expect(record.description).toBe("body");
    expect(record.fill).toBe("#123456");
  });

  test("the state argument overrides whatever the caller passed", () => {
    createToast({ id: "a", state: "success", title: "T" }, "error");
    expect(only().state).toBe("error");
  });

  test("the state argument wins without mutating the caller's object", () => {
    const options = { id: "a", state: "info" as const, title: "T" };
    createToast(options, "warning");
    expect(options.state).toBe("info");
    expect(only().state).toBe("warning");
  });

  test("state defaults to success when nothing supplies one", () => {
    createToast({ id: "a", title: "T" });
    expect(only().state).toBe("success");
  });

  test("each record gets its own instanceId", () => {
    createToast({ id: "a", title: "one" });
    createToast({ id: "b", title: "two" });
    const [first, second] = store.toasts;
    expect(first?.instanceId).not.toBe(second?.instanceId);
    expect(first?.instanceId.length).toBeGreaterThan(0);
  });

  test("append order is preserved", () => {
    createToast({ id: "a" });
    createToast({ id: "b" });
    createToast({ id: "c" });
    expect(ids()).toEqual(["a", "b", "c"]);
  });
});

describe("createToast dedup by id", () => {
  test("re-showing the same id replaces the record rather than stacking", () => {
    createToast({ id: "a", title: "first" });
    createToast({ id: "a", title: "second" });
    expect(store.toasts).toHaveLength(1);
    expect(only().title).toBe("second");
  });

  test("a replacement keeps its slot in the stack", () => {
    createToast({ id: "a" });
    createToast({ id: "b" });
    createToast({ id: "c" });
    createToast({ id: "a", title: "replaced" });
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(store.toasts[0]?.title).toBe("replaced");
  });

  test("a replacement gets a fresh instanceId so an in-flight exit timer misses it", () => {
    createToast({ id: "a" });
    const first = only().instanceId;
    createToast({ id: "a" });
    expect(only().instanceId).not.toBe(first);
  });

  test("a replacement that drops the position keeps the previous one", () => {
    createToast({ id: "a", position: "bottom-left" });
    createToast({ id: "a", title: "again" });
    expect(only().position).toBe("bottom-left");
  });

  test("a replacement can still move position explicitly", () => {
    createToast({ id: "a", position: "bottom-left" });
    createToast({ id: "a", position: "top-center" });
    expect(only().position).toBe("top-center");
  });

  test("an id held by an exiting record is replaced, not deduplicated", () => {
    // The exiting record is stale, so the new toast must become the live one.
    createToast({ id: "a" });
    store.update((all) => all.map((item) => ({ ...item, exiting: true })));
    createToast({ id: "a", title: "fresh" });
    expect(store.toasts).toHaveLength(1);
    expect(only().exiting).toBe(false);
    expect(only().title).toBe("fresh");
  });
});

describe("position defaulting", () => {
  test("falls back to the store's configured position", () => {
    createToast({ id: "a" });
    expect(only().position).toBe("top-right");
  });

  test("the store's position overrides its own default", () => {
    store.position = "bottom-center";
    createToast({ id: "a" });
    expect(only().position).toBe("bottom-center");
  });

  test("the caller's position beats the store's", () => {
    store.position = "bottom-center";
    createToast({ id: "a", position: "top-left" });
    expect(only().position).toBe("top-left");
  });

  test("every declared position round-trips through the record", () => {
    for (const position of TOAST_POSITIONS) {
      store.update(() => []);
      createToast({ id: position, position });
      expect(only().position).toBe(position);
    }
  });
});
describe("toaster option merging", () => {
  test("store options apply under the caller's options", () => {
    store.options = { fill: "#111111", roundness: 10, title: "default" };
    createToast({ id: "a" });
    const record = only();
    expect(record.fill).toBe("#111111");
    expect(record.roundness).toBe(10);
    expect(record.title).toBe("default");
  });

  test("the caller's options win over the store's", () => {
    store.options = { fill: "#111111", title: "default" };
    createToast({ fill: "#222222", id: "a", title: "mine" });
    expect(only().fill).toBe("#222222");
    expect(only().title).toBe("mine");
  });

  test("styles merge one level deep so a single slot can be overridden", () => {
    store.options = { styles: { badge: "b0", title: "t0" } };
    createToast({ id: "a", styles: { title: "t1" } });
    expect(only().styles).toEqual({ badge: "b0", title: "t1" });
  });

  test("styles exist as an object even when neither side supplies one", () => {
    createToast({ id: "a" });
    expect(only().styles).toEqual({});
  });

  test("store options reach a toast created with no options at all", () => {
    store.options = { position: "bottom-right", state: "warning" };
    createToast({});
    const record = only();
    expect(record.position).toBe("bottom-right");
    expect(record.state).toBe("warning");
  });
});

describe("duration on the record", () => {
  test("an absent duration becomes the default", () => {
    createToast({ id: "a" });
    expect(only().duration).toBe(DEFAULT_DURATION);
  });

  test("a null duration stays null, so a sticky toast never times out", () => {
    createToast({ duration: null, id: "a" });
    expect(only().duration).toBeNull();
  });

  test("an explicit duration is preserved verbatim", () => {
    createToast({ duration: 1234, id: "a" });
    expect(only().duration).toBe(1234);
  });

  test("a null duration carries no autopilot delays", () => {
    createToast({ autopilot: true, duration: null, id: "a" });
    const record = only();
    expect(record.duration).toBeNull();
    expect(record.autoExpandDelayMs).toBeUndefined();
    expect(record.autoCollapseDelayMs).toBeUndefined();
  });

  test("a timed duration gets the default autopilot delays", () => {
    createToast({ id: "a" });
    const record = only();
    expect(record.autoExpandDelayMs).toBe(AUTO_EXPAND_DELAY);
    expect(record.autoCollapseDelayMs).toBe(AUTO_COLLAPSE_DELAY);
  });

  test("autopilot false strips the delays but keeps the duration", () => {
    createToast({ autopilot: false, id: "a" });
    const record = only();
    expect(record.autoExpandDelayMs).toBeUndefined();
    expect(record.autoCollapseDelayMs).toBeUndefined();
    expect(record.duration).toBe(DEFAULT_DURATION);
  });

  test("autopilot delays are clamped to a short duration", () => {
    createToast({ autopilot: true, duration: 500, id: "a" });
    const record = only();
    expect(record.autoCollapseDelayMs).toBe(500);
    expect(record.autoExpandDelayMs).toBe(AUTO_EXPAND_DELAY);
  });
});

describe("isTimedDuration", () => {
  test("a positive duration is timed, so it shows a timeout track", () => {
    expect(isTimedDuration(1)).toBe(true);
    expect(isTimedDuration(DEFAULT_DURATION)).toBe(true);
  });

  test("null, zero and negatives are not timed", () => {
    expect(isTimedDuration(null)).toBe(false);
    expect(isTimedDuration(0)).toBe(false);
    expect(isTimedDuration(-1)).toBe(false);
  });

  test("it agrees with what the store put on the record", () => {
    createToast({ duration: null, id: "sticky" });
    createToast({ duration: 900, id: "timed" });
    createToast({ duration: 0, id: "zero" });
    const byId = new Map(store.toasts.map((item) => [item.id, item]));
    expect(isTimedDuration(byId.get("sticky")?.duration ?? null)).toBe(false);
    expect(isTimedDuration(byId.get("timed")?.duration ?? null)).toBe(true);
    expect(isTimedDuration(byId.get("zero")?.duration ?? null)).toBe(false);
  });
});

describe("timeoutKey", () => {
  test("joins the id and instanceId so a reused id cannot inherit a timer", () => {
    expect(timeoutKey(makeRecord("a", "i1"))).toBe("a:i1");
    expect(timeoutKey(makeRecord("a", "i2"))).toBe("a:i2");
    expect(timeoutKey(makeRecord("b", "i1"))).toBe("b:i1");
  });

  test("two records sharing an id but not an instance get different keys", () => {
    expect(timeoutKey(makeRecord("a", "i1"))).not.toBe(
      timeoutKey(makeRecord("a", "i2"))
    );
  });
});
describe("updateToast", () => {
  test("an unknown id is a no-op", () => {
    createToast({ id: "a", title: "T" });
    updateToast("missing", { title: "nope" });
    expect(ids()).toEqual(["a"]);
    expect(only().title).toBe("T");
  });

  test("an update replaces the record's options", () => {
    createToast({ description: "old", id: "a", title: "old" });
    updateToast("a", { title: "new" });
    expect(only().title).toBe("new");
  });

  test("an update cannot change the id it targets", () => {
    createToast({ id: "a" });
    updateToast("a", { id: "b" });
    expect(ids()).toEqual(["a"]);
  });

  test("an update keeps the record's position when none is given", () => {
    createToast({ id: "a", position: "bottom-left" });
    updateToast("a", { title: "new" });
    expect(only().position).toBe("bottom-left");
  });

  test("an update can move position explicitly", () => {
    createToast({ id: "a", position: "bottom-left" });
    updateToast("a", { position: "top-right" });
    expect(only().position).toBe("top-right");
  });

  test("an update clears the exiting flag, which is how a re-show revives", () => {
    createToast({ id: "a" });
    store.update((all) => all.map((item) => ({ ...item, exiting: true })));
    updateToast("a", { state: "success" });
    expect(only().exiting).toBe(false);
  });

  test("an update restarts the exit-window identity", () => {
    createToast({ id: "a" });
    const before = only().instanceId;
    updateToast("a", { title: "new" });
    expect(only().instanceId).not.toBe(before);
  });

  test("an update re-derives duration and autopilot from the new options", () => {
    createToast({ autopilot: true, id: "a" });
    expect(only().autoCollapseDelayMs).toBe(AUTO_COLLAPSE_DELAY);
    updateToast("a", { duration: null });
    const updated = only();
    expect(updated.duration).toBeNull();
    expect(updated.autoCollapseDelayMs).toBeUndefined();
  });

  test("updating one record leaves the rest untouched", () => {
    createToast({ id: "a", title: "a" });
    createToast({ id: "b", title: "b" });
    updateToast("a", { title: "a2" });
    expect(store.toasts.map((item) => item.title)).toEqual(["a2", "b"]);
  });
});

describe("dismissToast", () => {
  test("marks the record exiting immediately", () => {
    createToast({ id: "a" });
    dismissToast("a");
    expect(store.toasts).toHaveLength(1);
    expect(only().exiting).toBe(true);
  });

  test("an unknown id is a no-op", () => {
    createToast({ id: "a" });
    dismissToast("missing");
    expect(only().exiting).toBe(false);
  });

  test("dismissing twice does not stack a second exit timer", () => {
    createToast({ id: "a" });
    dismissToast("a");
    dismissToast("a");
    expect(store.toasts).toHaveLength(1);
  });

  test("leaves the other records alone", () => {
    createToast({ id: "a" });
    createToast({ id: "b" });
    dismissToast("a");
    expect(store.toasts[0]?.exiting).toBe(true);
    expect(store.toasts[1]?.exiting).toBe(false);
  });

  test("the record stays in the store through the exit animation", () => {
    // Removal is deferred so the exit transition has something to animate.
    createToast({ id: "a" });
    dismissToast("a");
    expect(store.toasts).toHaveLength(1);
  });
});

describe("subscribe", () => {
  test("a subscriber is called on every emit with the new stack", () => {
    const seen: string[][] = [];
    const unsubscribe = store.subscribe((toasts) => {
      seen.push(toasts.map((item) => item.id));
    });
    createToast({ id: "a" });
    createToast({ id: "b" });
    unsubscribe();
    expect(seen).toEqual([["a"], ["a", "b"]]);
  });

  test("unsubscribing stops the notifications", () => {
    const seen: number[] = [];
    const unsubscribe = store.subscribe((toasts) => {
      seen.push(toasts.length);
    });
    createToast({ id: "a" });
    unsubscribe();
    createToast({ id: "b" });
    expect(seen).toEqual([1]);
  });

  test("several subscribers all get the same stack", () => {
    const first: number[] = [];
    const second: number[] = [];
    store.subscribe((toasts) => first.push(toasts.length));
    store.subscribe((toasts) => second.push(toasts.length));
    createToast({ id: "a" });
    createToast({ id: "b" });
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
  });

  test("the same function subscribed twice is visited once", () => {
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    store.subscribe(listener);
    store.subscribe(listener);
    createToast({ id: "a" });
    expect(calls).toBe(1);
  });

  test("dismissal emits too, so the view can start the exit animation", () => {
    const seen: ToastRecord[][] = [];
    const unsubscribe = store.subscribe((toasts) => {
      seen.push([...toasts]);
    });
    createToast({ id: "a" });
    dismissToast("a");
    unsubscribe();
    expect(seen).toHaveLength(2);
    expect(seen[1]?.[0]?.exiting).toBe(true);
  });
});

describe("deferred removal after the exit animation", () => {
  // The store schedules removal on a real `setTimeout`, so these advance a fake
  // clock rather than sleeping through EXIT_DURATION.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("the record is still present just before the window closes", () => {
    createToast({ id: "a" });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION - 1);
    expect(ids()).toEqual(["a"]);
  });

  test("the record is gone once the exit window closes", () => {
    createToast({ id: "a" });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(store.toasts).toHaveLength(0);
  });

  test("only the dismissed record is removed", () => {
    createToast({ id: "a" });
    createToast({ id: "b" });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(ids()).toEqual(["b"]);
  });

  test("re-showing the same id mid-exit survives the old exit timer", () => {
    // This is what `id:instanceId` keys the timer on: the replacement must not
    // be removed by the timer the previous toast left behind.
    createToast({ id: "a", title: "old" });
    dismissToast("a");
    createToast({ id: "a", title: "new" });
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(ids()).toEqual(["a"]);
    expect(only().title).toBe("new");
    expect(only().exiting).toBe(false);
  });

  test("a replacement shown after the old exit completes still survives", () => {
    createToast({ id: "a", title: "old" });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(store.toasts).toHaveLength(0);
    createToast({ id: "a", title: "new" });
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(ids()).toEqual(["a"]);
    expect(only().title).toBe("new");
  });

  test("dismissing two ids removes both on their own timers", () => {
    createToast({ id: "a" });
    createToast({ id: "b" });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION - 1);
    dismissToast("b");
    jest.advanceTimersByTime(1);
    expect(ids()).toEqual(["b"]);
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(store.toasts).toHaveLength(0);
  });

  test("the removal notifies subscribers", () => {
    const seen: number[] = [];
    createToast({ id: "a" });
    const unsubscribe = store.subscribe((toasts) => {
      seen.push(toasts.length);
    });
    dismissToast("a");
    jest.advanceTimersByTime(EXIT_DURATION);
    unsubscribe();
    expect(seen).toEqual([1, 0]);
  });

  test("a cleared toast is never removed again by a stale timer", () => {
    createToast({ id: "a" });
    dismissToast("a");
    store.update(() => []);
    jest.advanceTimersByTime(EXIT_DURATION);
    expect(store.toasts).toHaveLength(0);
  });
});

describe("default placement", () => {
  test("a toast raised before the toaster mounts is re-homed once it does", () => {
    // The regression this guards: on native the toaster is a component, so a
    // toast raised during splash/font-load/session-bootstrap resolves against
    // the store's built-in default. It used to stay at `top-right` forever.
    const early = createToast({ title: "early" });
    expect(only().position).toBe("top-right");
    expect(only().pinnedPosition).toBe(false);

    setDefaultPosition("bottom-right");

    expect(only().position).toBe("bottom-right");
    expect(ids()).toEqual([early]);
  });

  test("a toast with an explicit position keeps it", () => {
    createToast({ id: "pinned", position: "top-left", title: "pinned" });
    expect(only().pinnedPosition).toBe(true);

    setDefaultPosition("bottom-right");

    expect(only().position).toBe("top-left");
  });

  test("re-homes only the unpinned toast when the stack is mixed", () => {
    createToast({ id: "free", title: "free" });
    createToast({ id: "fixed", position: "top-center", title: "fixed" });

    setDefaultPosition("bottom-left");

    const byId = new Map(store.toasts.map((r) => [r.id, r]));
    expect(byId.get("free")?.position).toBe("bottom-left");
    expect(byId.get("fixed")?.position).toBe("top-center");
  });

  test("setting the same default does not emit", () => {
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    setDefaultPosition("top-right");
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  test("toasts raised after the default lands use the new placement", () => {
    setDefaultPosition("bottom-center");
    createToast({ title: "late" });
    expect(only().position).toBe("bottom-center");
    expect(only().pinnedPosition).toBe(false);
  });

  test("an in-place update does not unpin an explicitly placed toast", () => {
    createToast({ id: "p", position: "top-left", title: "p" });
    updateToast("p", { title: "still p" });
    expect(only().position).toBe("top-left");
    expect(only().pinnedPosition).toBe(true);

    setDefaultPosition("bottom-right");
    expect(only().position).toBe("top-left");
  });

  test("an in-place update keeps an unpinned toast free to follow the default", () => {
    createToast({ id: "f", title: "f" });
    updateToast("f", { title: "f2" });
    expect(only().pinnedPosition).toBe(false);

    setDefaultPosition("bottom-right");
    expect(only().position).toBe("bottom-right");
  });

  test("re-showing an id keeps its pinned placement", () => {
    createToast({ id: "p", position: "top-left", title: "p" });
    createToast({ id: "p", title: "p again" });

    expect(only().pinnedPosition).toBe(true);
    setDefaultPosition("bottom-right");
    expect(only().position).toBe("top-left");
  });
});

// Minimal record factory for the pure `timeoutKey` cases, which need no store
// state at all.
function makeRecord(id: string, instanceId: string): ToastRecord {
  return {
    duration: DEFAULT_DURATION,
    exiting: false,
    id,
    instanceId,
    pinnedPosition: false,
    position: "top-right",
    state: "success",
    styles: {},
  };
}
