// better-auth client for the native app. Session cookies live in
// expo-secure-store (encrypted keychain/keystore), never in cleartext.
// All calls ride the web proxy (/api/auth/*), which injects origin +
// x-internal-secret server-side — the app carries no secrets.
import { expoClient } from "@better-auth/expo/client";
import { expoPasskeyClient } from "@lobehub/expo-better-auth-passkey";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { getAuthBaseUrl } from "./api-env";

// Native passkey bridge. Throws where no native module exists (Expo Go);
// the login screen then falls back to a clear notice instead of crashing.
function getPasskeyPlugin(): ReturnType<typeof expoPasskeyClient> | null {
  try {
    return expoPasskeyClient();
  } catch {
    return null;
  }
}

const passkeyPlugin = getPasskeyPlugin();

export const hasNativePasskey = passkeyPlugin !== null;

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [
    usernameClient(),
    // The passkey bridge bundles its own @better-fetch copy, so its plugin
    // type is structurally identical but nominally incompatible. Runtime is
    // unaffected (plain plugin object), hence the narrow cast.
    ...(passkeyPlugin
      ? [passkeyPlugin as unknown as BetterAuthClientPlugin]
      : []),
    // The form renders the 2FA challenge inline after it receives the
    // redirect flag, so the plugin must not navigate away on its own.
    twoFactorClient({
      onTwoFactorRedirect: () => {
        /* handled by the login screen */
      },
    }),
    expoClient({
      scheme: "asocialmedia",
      storage: SecureStore,
      storagePrefix: "asocialmedia",
    }),
  ],
});
