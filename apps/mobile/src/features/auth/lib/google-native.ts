// Native Google sign-in (ID-token flow). The Google SDK signs the user in
// with the platform account picker and hands back an ID token minted for our
// WEB client id; the auth service verifies that token directly
// (`signIn.social({ idToken })`), so no browser round-trip and no OAuth
// redirect host to line up. Reddit has no such SDK and stays browser-based.
//
// The module is a native Expo module, so it is loaded lazily and guarded
// exactly like the passkey bridge: a static import would evaluate the native
// binding at startup and crash Expo Go, where it does not exist.

import Constants from "expo-constants";
import { Platform } from "react-native";

import { logError } from "@/lib/telemetry";

// Type-only view of the SDK so the plugin's types are kept without a runtime
// import of the native module (same trick as the passkey bridge).
// eslint-disable-next-line typescript/consistent-type-imports -- the module namespace is what we need to type the lazy require result
type GoogleSdk = typeof import("@react-native-google-signin/google-signin");

// Public OAuth client id of the auth server (its GOOGLE_CLIENT_ID). Not a
// secret; the SDK uses it as the ID token audience.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();

// iOS OAuth client id. There is none yet (no reversed
// `com.googleusercontent.apps.*` scheme is registered in app.json), so the
// native flow stays off on iOS until this is configured. Setting this alone is
// not enough - the matching iosUrlScheme must be added to the Expo config too.
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

function loadGoogleModule(): GoogleSdk | null {
  if (Constants.executionEnvironment === "storeClient") {
    return null;
  }
  try {
    // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- guarded lazy require: a static import evaluates the native module at startup and crashes Expo Go
    return require("@react-native-google-signin/google-signin") as GoogleSdk;
  } catch {
    return null;
  }
}

const googleModule = loadGoogleModule();

/** True when the native SDK is present AND a web client id is configured. */
export const hasNativeGoogle =
  googleModule !== null &&
  Boolean(WEB_CLIENT_ID) &&
  // iOS needs its own OAuth client (reversed URL scheme) on top of the web
  // client id. Until one is configured the native flow would hand Google a
  // callback scheme the app does not own, so it stays off there and iOS falls
  // back to the browser flow.
  (Platform.OS !== "ios" || Boolean(IOS_CLIENT_ID));

let configured = false;

function ensureConfigured(module: GoogleSdk): void {
  if (configured) {
    return;
  }
  module.GoogleSignin.configure({
    iosClientId: IOS_CLIENT_ID,
    // The server never calls Google APIs on the user's behalf; it only needs
    // the identity token, so no offline access / server auth code.
    offlineAccess: false,
    webClientId: WEB_CLIENT_ID,
  });
  configured = true;
}

export type NativeGoogleResult =
  | { accessToken: string; idToken: string }
  | { cancelled: true }
  | { error: string };

export const GOOGLE_UNAVAILABLE_ERROR = "Google sign-in isn't available yet.";
export const GOOGLE_GENERIC_ERROR = "Error connecting with social provider.";

/** Runs the native account picker and returns Google's tokens. */
export async function signInWithGoogleNative(): Promise<NativeGoogleResult> {
  if (!(googleModule && hasNativeGoogle)) {
    return { error: GOOGLE_UNAVAILABLE_ERROR };
  }
  const { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } =
    googleModule;
  try {
    ensureConfigured(googleModule);
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) {
      return { cancelled: true };
    }
    const tokens = await GoogleSignin.getTokens();
    if (!tokens.idToken) {
      logError("auth.google_native_no_id_token", new Error("empty idToken"));
      return { error: GOOGLE_GENERIC_ERROR };
    }
    return { accessToken: tokens.accessToken, idToken: tokens.idToken };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { cancelled: true };
      }
      if (error.code === statusCodes.IN_PROGRESS) {
        return { error: "Google sign-in is already open." };
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { error: "Google Play services are needed for this." };
      }
      if (error.code === "DEVELOPER_ERROR") {
        // The Android OAuth client (package + signing SHA-1) is missing in
        // Google Cloud for this build's keystore. See .env.development.
        logError("auth.google_native_developer_error", error);
        return { error: GOOGLE_UNAVAILABLE_ERROR };
      }
    }
    logError("auth.google_native_failed", error);
    return { error: GOOGLE_GENERIC_ERROR };
  }
}
