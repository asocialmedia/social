import { useColorScheme } from "react-native";

import { THEMES } from "./theme";
import type { AppTheme } from "./theme";
import { resolveThemePreference } from "./theme-preference";
import { useThemePreference } from "./theme-preference-native";

export interface UseAppThemeResult {
  colorScheme: "light" | "dark";
  isDark: boolean;
  theme: AppTheme;
}

export function useAppTheme(): UseAppThemeResult {
  const scheme = useColorScheme();
  const preference = useThemePreference((state) => state.preference);
  const isDark = resolveThemePreference(preference, scheme) === "dark";
  const theme = isDark ? THEMES.dark : THEMES.light;
  const colorScheme = isDark ? "dark" : "light";

  return {
    colorScheme,
    isDark,
    theme,
  };
}
