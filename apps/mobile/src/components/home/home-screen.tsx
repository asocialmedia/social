// Root home page: mobile header, empty feed area, guest auth bar docked
// at the bottom. Signed-in users get their avatar in the header (same as
// web); guests get the Log in pill. UI-only otherwise: feed not ported yet.
import { StyleSheet, View } from "react-native";

import { useSessionContext } from "@/state/session";
import { useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
import { MobileHeader } from "./mobile-header";

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const { user } = useSessionContext();

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        user={
          user
            ? {
                avatarUrl: user.image ?? null,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      <View style={styles.feed} />
      {user ? null : <GuestAuthBar />}
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
