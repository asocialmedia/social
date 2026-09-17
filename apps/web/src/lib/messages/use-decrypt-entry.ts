"use client";

import { useSyncExternalStore } from "react";

import type { DecryptEntry } from "./decryptor";
import { messageDecryptor } from "./decryptor";

// Row-level subscription to a single message's decrypt result. Subscribing
// per row (instead of the whole thread watching a global version) means a
// completion batch re-renders only the rows whose payloads landed, which is
// what keeps scrolling smooth while background decrypts finish.
//
// The snapshot is the cached entry itself: the decryptor stores stable
// references (payload objects are written once and never mutated), so
// useSyncExternalStore's identity check holds between unrelated updates.
// Server snapshot is always empty: the decryptor only runs in the browser.
// Declared with a block body so the formatter cannot collapse it into `{}`.
function getServerSnapshot(): DecryptEntry | undefined {
  return undefined;
}

export function useDecryptEntry(
  id: string | undefined
): DecryptEntry | undefined {
  return useSyncExternalStore(
    messageDecryptor.subscribe,
    () => (id ? messageDecryptor.get(id) : undefined),
    getServerSnapshot
  );
}
