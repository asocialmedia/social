import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { store } from "./store";
import {
  configureToaster,
  createToaster,
  gooeyToast,
  registerToaster,
  toast,
  unmountToaster,
} from "./toast";
import { TOAST_POSITIONS } from "./types";

// The store and the toaster registry are module singletons, so each test starts
// from an empty stack with default configuration and no mounted toaster.
beforeEach(() => {
  store.update(() => []);
  store.options = undefined;
  store.position = "top-right";
  registerToaster(null);
});

afterEach(() => {
  store.update(() => []);
  store.options = undefined;
  store.position = "top-right";
  registerToaster(null);
});

const only = () => {
  expect(store.toasts).toHaveLength(1);
  const [record] = store.toasts;
  expect(record).toBeDefined();
  return record as (typeof store.toasts)[number];
};

describe("state helpers", () => {
  test("each helper stamps its own state", () => {
    toast.error({ id: "e" });
    expect(only().state).toBe("error");
    store.update(() => []);
    toast.info({ id: "i" });
    expect(only().state).toBe("info");
    store.update(() => []);
    toast.warning({ id: "w" });
    expect(only().state).toBe("warning");
    store.update(() => []);
    toast.success({ id: "s" });
    expect(only().state).toBe("success");
  });

  test("show passes the caller's state through", () => {
    toast.show({ id: "a", state: "info" });
    expect(only().state).toBe("info");
  });

  test("show with no state falls back to success", () => {
    toast.show({ id: "a" });
    expect(only().state).toBe("success");
  });

  test("every helper returns the record's id", () => {
    expect(toast.success({ id: "named" })).toBe("named");
    store.update(() => []);
    expect(toast.error({ id: "named" })).toBe("named");
    store.update(() => []);
    expect(toast.info({ id: "named" })).toBe("named");
    store.update(() => []);
    expect(toast.warning({ id: "named" })).toBe("named");
    store.update(() => []);
    expect(toast.show({ id: "named" })).toBe("named");
  });

  test("gooeyToast is the same object as toast, for the upstream alias", () => {
    expect(gooeyToast).toBe(toast);
  });

  test("a state helper does not mutate the caller's options object", () => {
    const options = { id: "a", title: "T" };
    toast.error(options);
    expect(options).toEqual({ id: "a", title: "T" });
  });
});

describe("toast.clear", () => {
  test("empties the whole stack when no position is given", () => {
    toast.success({ id: "a" });
    toast.success({ id: "b" });
    toast.clear();
    expect(store.toasts).toHaveLength(0);
  });

  test("clears only the named position", () => {
    toast.success({ id: "a", position: "top-left" });
    toast.success({ id: "b", position: "bottom-right" });
    toast.clear("top-left");
    expect(store.toasts.map((item) => item.id)).toEqual(["b"]);
  });

  test("clearing an empty position is a no-op", () => {
    toast.success({ id: "a", position: "top-left" });
    toast.clear("bottom-right");
    expect(store.toasts.map((item) => item.id)).toEqual(["a"]);
  });

  test("every declared position can be cleared by name", () => {
    for (const position of TOAST_POSITIONS) {
      store.update(() => []);
      toast.success({ id: "a", position });
      toast.clear(position);
      expect(store.toasts).toHaveLength(0);
    }
  });

  test("clearing notifies subscribers", () => {
    const seen: number[] = [];
    toast.success({ id: "a" });
    const unsubscribe = store.subscribe((toasts) => {
      seen.push(toasts.length);
    });
    toast.clear();
    unsubscribe();
    expect(seen).toEqual([0]);
  });
});

describe("toast.dismiss", () => {
  test("marks the named toast exiting", () => {
    toast.success({ id: "a" });
    toast.dismiss("a");
    expect(only().exiting).toBe(true);
  });

  test("an unknown id is a no-op", () => {
    toast.success({ id: "a" });
    toast.dismiss("nope");
    expect(only().exiting).toBe(false);
  });
});
// `settle` is fire-and-forget, so a macrotask turn is needed before the updated
// record lands. `Bun.sleep(0)` defers a whole turn without hand-rolling a
// promise the test does not need to resolve itself.
const flush = () => Bun.sleep(0);

describe("toast.promise", () => {
  // A promise that is never settled, for asserting the loading toast stays put.
  // `withResolvers` hands back the resolve functions and this test just never
  // calls them.
  const never = Promise.withResolvers<never>().promise;

  const bags = {
    error: { title: "e" },
    loading: { title: "Working" },
    success: { title: "Done" },
  };

  test("shows a sticky loading toast immediately", () => {
    toast.promise(never, bags);
    const record = only();
    expect(record.state).toBe("loading");
    expect(record.title).toBe("Working");
  });

  test("a loading toast has a null duration so it cannot time out", () => {
    toast.promise(never, bags);
    expect(only().duration).toBeNull();
  });

  test("the promise position is honoured", () => {
    toast.promise(never, { ...bags, position: "bottom-left" });
    expect(only().position).toBe("bottom-left");
  });

  test("a resolving promise advances the same toast to success", async () => {
    await toast.promise(Promise.resolve("payload"), {
      ...bags,
      success: (data) => ({ title: `Saved ${data}` }),
    });
    await flush();
    expect(store.toasts).toHaveLength(1);
    const record = only();
    expect(record.state).toBe("success");
    expect(record.title).toBe("Saved payload");
  });

  test("a rejecting promise advances the same toast to error", async () => {
    const failure = new Error("nope");
    const settled = toast.promise(Promise.reject(failure), {
      ...bags,
      error: (err) => ({
        title: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    });
    // The rejection is the point of the test, so it is swallowed here and the
    // toast's error state is what gets asserted.
    await settled.catch(() => {
      // expected
    });
    await flush();
    expect(only().state).toBe("error");
    expect(only().title).toBe("Failed: nope");
  });

  test("it returns the caller's promise, not the settled copy", async () => {
    const pending = Promise.resolve(7);
    const returned = toast.promise(pending, bags);
    expect(returned).toBe(pending);
    await pending;
    await flush();
  });

  test("a thunk is invoked and its promise is the one that settles", async () => {
    let started = false;
    await toast.promise(() => {
      started = true;
      return Promise.resolve(1);
    }, bags);
    await flush();
    expect(started).toBe(true);
    expect(only().state).toBe("success");
  });

  test("an action stops at the action state rather than resolving to success", async () => {
    // Upstream hands control back to the caller here, so the toast must not
    // advance past `action`.
    await toast.promise(Promise.resolve("x"), {
      ...bags,
      action: { title: "Retry?" },
    });
    await flush();
    expect(only().state).toBe("action");
    expect(only().title).toBe("Retry?");
  });

  test("a non-function success bag is used as-is", async () => {
    await toast.promise(Promise.resolve("x"), bags);
    await flush();
    expect(only().title).toBe("Done");
  });

  test("the promise does not add a toast when it settles", async () => {
    await toast.promise(Promise.resolve("x"), bags);
    await flush();
    expect(store.toasts).toHaveLength(1);
  });
});

describe("createToaster", () => {
  test("sets the store's default position", () => {
    createToaster({ position: "bottom-right" });
    expect(store.position).toBe("bottom-right");
    toast.success({ id: "a" });
    expect(only().position).toBe("bottom-right");
  });

  test("leaves the position alone when none is given", () => {
    store.position = "bottom-left";
    createToaster({});
    expect(store.position).toBe("bottom-left");
  });

  test("sets the store's default options when supplied", () => {
    createToaster({ options: { fill: "#abcdef", roundness: 22 } });
    expect(store.options).toEqual({ fill: "#abcdef", roundness: 22 });
    toast.success({ id: "a" });
    expect(only().fill).toBe("#abcdef");
  });

  test("leaves existing store options alone when none are supplied", () => {
    store.options = { fill: "#111111" };
    createToaster({ position: "top-left" });
    expect(store.options).toEqual({ fill: "#111111" });
  });

  test("emits so an already-mounted toaster re-renders", () => {
    const seen: number[] = [];
    toast.success({ id: "a" });
    const unsubscribe = store.subscribe((toasts) => {
      seen.push(toasts.length);
    });
    createToaster({ position: "top-left" });
    unsubscribe();
    expect(seen).toEqual([1]);
  });

  test("the handle's update reconfigures the store", () => {
    const handle = createToaster({});
    handle.update({ position: "top-center" });
    expect(store.position).toBe("top-center");
  });

  test("unmounting with nothing registered is a no-op", () => {
    expect(() => createToaster({}).unmount()).not.toThrow();
  });

  test("unmounting reaches the registered handle", () => {
    let unmounts = 0;
    registerToaster({
      unmount: () => {
        unmounts += 1;
      },
      update: () => {
        // empty
      },
    });
    unmountToaster();
    expect(unmounts).toBe(1);
  });

  test("unmountToaster with nothing registered is a no-op", () => {
    expect(() => unmountToaster()).not.toThrow();
  });

  test("configureToaster applies to toasts created afterwards", () => {
    configureToaster({
      options: { fill: "#0f0f0f" },
      position: "bottom-right",
    });
    toast.success({ id: "a" });
    expect(only().fill).toBe("#0f0f0f");
    expect(only().position).toBe("bottom-right");
  });

  test("configureToaster works with no toaster mounted at all", () => {
    expect(() => configureToaster({ position: "top-right" })).not.toThrow();
  });
});
