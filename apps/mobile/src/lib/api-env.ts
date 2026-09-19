// React Native side of API base resolution. Baked at bundle time:
// - release APK: EXPO_PUBLIC_API_URL (EAS/build profiles) or prod default.
// - dev: EXPO_PUBLIC_DEV_API_URL for physical devices, else emulator/simulator loopback.
import { Platform } from "react-native";

import { authBaseUrl, resolveApiBaseUrl } from "./api-base";

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    dev: __DEV__,
    devApiUrl: process.env.EXPO_PUBLIC_DEV_API_URL,
    platform: Platform.OS,
    publicApiUrl: process.env.EXPO_PUBLIC_API_URL,
  });
}

export function getAuthBaseUrl(): string {
  return authBaseUrl(getApiBaseUrl());
}
