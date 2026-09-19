import "../global.css";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";

import { useAppTheme } from "@/theme";

import sofiaProBold from "../../assets/fonts/SofiaProSoftBold.ttf";
import sofiaProMed from "../../assets/fonts/SofiaProSoftMed.ttf";
import sofiaProReg from "../../assets/fonts/SofiaProSoftReg.ttf";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { isDark, theme } = useAppTheme();

  const [loaded, error] = useFonts({
    SofiaPro: sofiaProReg,
    SofiaProBold: sofiaProBold,
    SofiaProMed: sofiaProMed,
    SofiaProReg: sofiaProReg,
    "SofiaProSoft-Bold": sofiaProBold,
    "SofiaProSoft-Medium": sofiaProMed,
    "SofiaProSoft-Regular": sofiaProReg,
  });

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.containerBg);
  }, [theme.containerBg]);

  useEffect(() => {
    async function hideSplash() {
      if (loaded || error) {
        try {
          await SplashScreen.hideAsync();
        } catch {
          // Splash screen hide failed or was already hidden
        }
      }
    }
    void hideSplash();
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.containerBg },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </ThemeProvider>
  );
}
