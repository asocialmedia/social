import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";

import { createThemePreferenceStore } from "./theme-preference";

export const useThemePreference = createThemePreferenceStore({
  getItem: async (key) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Unavailable storage must not prevent changing the current appearance.
    }
  },
  setItem: async (key, value) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Unavailable storage must not prevent changing the current appearance.
    }
  },
});

useThemePreference.subscribe((state, previous) => {
  if (state.preference !== previous.preference) {
    Appearance.setColorScheme(
      state.preference === "system" ? "unspecified" : state.preference
    );
  }
});

export async function hydrateThemePreference() {
  await useThemePreference.persist.rehydrate();
}
