import { describe, expect, test } from "bun:test";

import {
  createThemePreferenceStore,
  resolveThemePreference,
} from "./theme-preference";

describe("appearance preference", () => {
  test("explicit choices override the device and system follows it", () => {
    expect(resolveThemePreference("light", "dark")).toBe("light");
    expect(resolveThemePreference("dark", "light")).toBe("dark");
    expect(resolveThemePreference("system", "dark")).toBe("dark");
    expect(resolveThemePreference("system", "light")).toBe("light");
    expect(resolveThemePreference("system", null)).toBe("light");
  });
  test("survives a fresh launch without storing actions", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const first = createThemePreferenceStore(storage);
    first.getState().setPreference("dark");
    const second = createThemePreferenceStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().preference).toBe("dark");
    second.getState().setPreference("system");
    expect(
      JSON.parse(values.get("asm-theme-preference") ?? "{}").state
    ).toEqual({ preference: "system" });
  });
  test("invalid persisted choices recover to system", async () => {
    const store = createThemePreferenceStore({
      getItem: () =>
        JSON.stringify({ state: { preference: "invalid" }, version: 0 }),
      removeItem: () => {},
      setItem: () => {},
    });
    await store.persist.rehydrate();
    expect(store.getState().preference).toBe("system");
  });
});
