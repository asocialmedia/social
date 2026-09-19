import { useColorScheme } from "react-native";

import { THEMES } from "./theme";
import type { AppTheme } from "./theme";

export interface UseAppThemeResult {
  colorScheme: "light" | "dark";
  isDark: boolean;
  theme: AppTheme;
}

export function useAppTheme(): UseAppThemeResult {
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  const theme = isDark ? THEMES.dark : THEMES.light;
  const colorScheme = isDark ? "dark" : "light";

  return {
    colorScheme,
    isDark,
    theme,
  };
}
