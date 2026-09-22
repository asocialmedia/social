// Root home page: mobile header, empty feed area, guest auth bar docked
// at the bottom. Signed-in users get their avatar in the header (same as
// web); guests get the Log in pill. UI-only otherwise: feed not ported yet.
import { StyleSheet, View } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
import { MobileHeader } from "./mobile-header";

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const { isPending, user } = useSessionContext();
  // While the session is still resolving, `user` is null for everyone. Treating
  // that as "guest" flashes the Log in pill at signed-in users, so neither the
  // avatar nor the guest bar renders until the answer is known.
  const showUser = !isPending && Boolean(user);

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        user={
          showUser && user
            ? {
                avatarUrl: user.image ?? null,
                id: user.id,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      <View style={styles.feed} />
      {isPending || user ? null : <GuestAuthBar />}
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
