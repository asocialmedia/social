// Web's FossBanner, for the settings sidebar: the FOSS notice with the
// repository link. Web keeps it on the settings sidebar, which is the surface
// a reader reaches when they want to know what the project is and how to
// help, so it lives at the foot of the native settings screen too.
//
// The tile behind the glyph follows the app's own recipe rather than
// re-deriving web's orange gradient, so it sits in the same surface family as
// everything else on the screen.

import { GitPullRequest } from "lucide-react-native";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { APPLE_PANEL_TOKENS, themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

const REPOSITORY = "https://github.com/asocialmedia/social";

/** A reader with no browser still reads the notice, so a refusal is silent. */
function openRepository(): void {
  const open = async () => {
    try {
      await Linking.openURL(REPOSITORY);
    } catch {
      // Nothing to say: the notice itself still reads, and interrupting a
      // reader over a link they cannot open is worse than the silence.
    }
  };
  void open();
}

export function FossBanner() {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: panel.background, borderColor: panel.border },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.tileWrap}>
          <Gradient3D
            colors={["#ff9500", "#e65500"]}
            shadows=""
            style={styles.tile}
          />
          <View style={styles.tileGlyph}>
            <GitPullRequest color="#ffffff" size={16} />
          </View>
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: text.foreground }]}>
            Open Source Project
          </Text>
          <Text style={[styles.copy, { color: text.muted }]}>
            asocialmedia is a Free and Open Source Software (FOSS) project. We
            welcome contributions and suggestions. Visit our{" "}
            <Text
              accessibilityRole="link"
              onPress={openRepository}
              style={[styles.link, { color: text.foreground }]}
            >
              GitHub repository
            </Text>{" "}
            to contribute or provide feedback on our policies and documentation.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 4 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  copy: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 19 },
  link: { fontFamily: "SofiaProMed", textDecorationLine: "underline" },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  tile: { borderRadius: 12, height: 36, width: 36 },
  tileGlyph: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  tileWrap: { height: 36, width: 36 },
  title: { fontFamily: "SofiaProMed", fontSize: 14 },
});
