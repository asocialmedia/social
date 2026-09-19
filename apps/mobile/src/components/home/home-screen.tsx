// Root home page: mobile header, empty feed area, guest auth bar docked
// at the bottom. UI-only: the feed itself is not ported yet.

import { StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
import { MobileHeader } from "./mobile-header";

export default function HomeScreen() {
  const { theme } = useAppTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={null} />
      <View style={styles.feed} />
      <GuestAuthBar />
    </View>
  );
}

const styles = StyleSheet.create({
  feed: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
});
