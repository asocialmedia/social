// Shared atmospheric shell for every auth screen. Ports the apps/web
// AuthPage + AuthCard mobile presentation 1:1: full-bleed wallpaper image,
// gradient wash, centered 3D card (surface-3d), brand heading with divider,
// and the "Skip for now — continue browsing as guest" escape link.
// Expo Router v57: plain component, screens wrap themselves; navigation via
// useRouter from expo-router.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import asmLogo from "@/assets/images/asm.png";
import { useAppTheme } from "@/theme";

interface AuthShellProps {
  backgroundImage: number;
  children: ReactNode;
  heading: string;
  headingColor?: string;
  onGuestPress?: () => void;
}

export function AuthShell({
  backgroundImage,
  children,
  heading,
  headingColor = "#ff9500",
  onGuestPress,
}: AuthShellProps) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[styles.rootContainer, { backgroundColor: theme.containerBg }]}
    >
      <Image
        blurRadius={Platform.OS === "android" ? 14 : 20}
        contentFit="cover"
        source={backgroundImage}
        style={[StyleSheet.absoluteFill, { opacity: theme.bgImageOpacity }]}
      />
      <LinearGradient
        colors={theme.bgGradient}
        end={{ x: 0.85, y: 1 }}
        start={{ x: 0.15, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView
        edges={["top", "bottom", "left", "right"]}
        style={styles.safeArea}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardAvoid}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.cardWrapper}>
              <View
                className="relative w-full rounded-2xl p-6"
                style={[
                  styles.card3d,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                    shadowColor: theme.cardShadow,
                  },
                ]}
              >
                <View className="mb-1 flex-row items-center justify-center gap-2.5">
                  <Image
                    contentFit="contain"
                    source={asmLogo}
                    style={styles.brandLogo}
                  />
                  <Text
                    className="text-3xl tracking-tight"
                    style={[styles.fontBold, { color: headingColor }]}
                  >
                    {heading}
                  </Text>
                </View>
                <View
                  className="mx-auto my-3.5 h-px w-16"
                  style={{ backgroundColor: theme.headingDivider }}
                />
                {children}
              </View>
              <Pressable
                className="mt-4 flex-row items-center justify-center gap-1.5 py-1"
                hitSlop={6}
                onPress={onGuestPress}
              >
                <ArrowLeft color={theme.guestLink} size={15} />
                <Text
                  className="text-sm"
                  style={[styles.fontMedium, { color: theme.guestLink }]}
                >
                  Skip for now — continue browsing as guest
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  brandLogo: {
    height: 32,
    width: 44,
  },
  card3d: {
    borderRadius: 16,
    borderWidth: 1,
    ...Platform.select({
      android: {
        elevation: 3,
      },
      ios: {
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
    }),
  },
  cardWrapper: {
    maxWidth: 384,
    width: "100%",
  },
  fontBold: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
  },
  fontMedium: {
    fontFamily: "SofiaProMed",
    fontWeight: "normal",
  },
  keyboardAvoid: {
    flex: 1,
  },
  rootContainer: {
    flex: 1,
    height: "100%",
    width: "100%",
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
