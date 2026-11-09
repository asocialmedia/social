import { describe, expect, test } from "bun:test";

import { createMessageKeyStore } from "./secure-key-store";
import type { SecureStorageBackend } from "./secure-key-store";

const jwk: JsonWebKey = { crv: "P-256", kty: "EC", x: "x", y: "y" };

function fakeBackend() {
  const values = new Map<string, string>();
  const state = { failReads: 0, failWrites: false, reads: 0 };
  const backend: SecureStorageBackend = {
    deleteItemAsync: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    getItemAsync: (key) => {
      state.reads += 1;
      if (state.failReads > 0) {
        state.failReads -= 1;
        return Promise.reject(new Error("User not authenticated"));
      }
      return Promise.resolve(values.get(key) ?? null);
    },
    setItemAsync: (key, value) => {
      if (state.failWrites) {
        return Promise.reject(new Error("Keystore busy"));
      }
      values.set(key, value);
      return Promise.resolve();
    },
  };
  return { backend, state, values };
}

describe("message key store", () => {
  test("a transient read failure is not remembered for the session", async () => {
    const fake = fakeBackend();
    const store = createMessageKeyStore(() => Promise.resolve(fake.backend));
    await store.setPrivateKey("u1", jwk);
    store.forget();
    fake.state.failReads = 1;
    expect(await store.getPrivateKey("u1")).toBeNull();
    expect(await store.getPrivateKey("u1")).toEqual(jwk);
  });

  test("a confirmed absence is remembered", async () => {
    const fake = fakeBackend();
    const store = createMessageKeyStore(() => Promise.resolve(fake.backend));
    expect(await store.getPrivateKey("u1")).toBeNull();
    expect(await store.getPrivateKey("u1")).toBeNull();
    expect(fake.state.reads).toBe(1);
  });

  test("a failed write leaves no memo behind", async () => {
    const fake = fakeBackend();
    const store = createMessageKeyStore(() => Promise.resolve(fake.backend));
    fake.state.failWrites = true;
    await expect(store.setPrivateKey("u1", jwk)).rejects.toThrow();
    expect(await store.getPrivateKey("u1")).toBeNull();
    // The null above is a confirmed absence, read from the keychain.
    expect(fake.state.reads).toBe(1);
  });

  test("a successful write is served from the memo", async () => {
    const fake = fakeBackend();
    const store = createMessageKeyStore(() => Promise.resolve(fake.backend));
    await store.setPrivateKey("u1", jwk);
    expect(await store.getPrivateKey("u1")).toEqual(jwk);
    expect(fake.state.reads).toBe(0);
  });

  test("clear removes the key from the memo and the keychain", async () => {
    const fake = fakeBackend();
    const store = createMessageKeyStore(() => Promise.resolve(fake.backend));
    await store.setPrivateKey("u1", jwk);
    await store.clear("u1");
    expect(fake.values.size).toBe(0);
    expect(await store.getPrivateKey("u1")).toBeNull();
  });
});
