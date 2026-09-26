// Native port of web's `StatusScreen`: the centred illustration-or-logo,
// title, description and single action used by every full-page status state
// (error, not found, empty). Kept as one component so those states cannot drift
// apart in spacing or type.
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import asmLogo from "../../../assets/images/asm.png";

export function StatusScreen({
  action,
  description,
  image,
  logo = true,
  title,
}: {
  action?: ReactNode;
  description: string;
  image?: number;
  // The logo is the fallback mark, so a state with no illustration still reads
  // as branded rather than as a blank panel.
  logo?: boolean;
  title: string;
}) {
  const { theme } = useAppTheme();
  // Web renders the illustration if there is one and the logo otherwise, so the
  // two are resolved here rather than through a nested ternary in JSX.
  const mark = resolveMark(image, logo);
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      {mark}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.inputText }]}>{title}</Text>
        <Text style={[styles.description, { color: theme.dividerText }]}>
          {description}
        </Text>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

function resolveMark(image: number | undefined, logo: boolean) {
  if (image) {
    return (
      <Image
        contentFit="contain"
        source={image}
        // A status screen has nothing else to paint, so this is always the
        // largest element and always above the fold.
        style={styles.art}
      />
    );
  }
  if (logo) {
    return <Image contentFit="contain" source={asmLogo} style={styles.logo} />;
  }
  return null;
}

const styles = StyleSheet.create({
  action: { alignItems: "center" },
  art: { height: 208, width: 208 },
  copy: { alignItems: "center", gap: 8 },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 19,
    maxWidth: 340,
    textAlign: "center",
  },
  logo: { height: 64, width: 64 },
  root: {
    alignItems: "center",
    flex: 1,
    gap: 24,
    justifyContent: "center",
    padding: 16,
  },
  title: { fontFamily: "SofiaProBold", fontSize: 20, textAlign: "center" },
});
