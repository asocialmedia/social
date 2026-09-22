// better-auth client for the native app. Session cookies live in
// expo-secure-store (encrypted keychain/keystore), never in cleartext.
// All calls ride the web proxy (/api/auth/*), which injects origin +
// x-internal-secret server-side — the app carries no secrets.
import { expoClient } from "@better-auth/expo/client";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { getAuthBaseUrl } from "@/lib/api-env";

// Type-only view of the passkey bridge, so the plugin's inferred type is kept
// without emitting a runtime import of the native module. The package exports
// only the function, so there is no named type for a plain `import type`, and
// TypeScript rejects `typeof` on a type-only import.
// eslint-disable-next-line typescript/consistent-type-imports -- the package exports no named type to import instead
type PasskeyBridgeModule = typeof import("@lobehub/expo-better-auth-passkey");
type PasskeyPlugin = ReturnType<PasskeyBridgeModule["expoPasskeyClient"]>;

// Native passkey bridge. The bridge calls `requireNativeModule()` while its
// OWN module is still evaluating, and that throws in Expo Go where the native
// module is absent. A static `import` therefore blew up before this file's
// try/catch could ever run, which failed module evaluation for everything that
// imports the auth client - expo-router then reported those routes as "missing
// the required default export" and the root layout crashed on `ErrorBoundary`.
// Loading it through a guarded `require` defers that evaluation, so a missing
// native module degrades to "no passkey" as this file always intended.
function getPasskeyPlugin(): PasskeyPlugin | null {
  // Expo Go (and dev clients reporting a store environment) ship no native
  // modules beyond the sandbox, so requiring the bridge here would throw
  // (and log a redbox) before the guard below could matter. Dev builds and
  // release APKs autolink it via prebuild instead.
  if (Constants.executionEnvironment === "storeClient") {
    return null;
  }
  try {
    // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- guarded lazy require is the whole point: a static import evaluates the native module at startup and crashes Expo Go
    const bridge = require("@lobehub/expo-better-auth-passkey");
    return (bridge as PasskeyBridgeModule).expoPasskeyClient();
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
