import { Link2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { IconButton3D } from "@/components/surface/icon-button-3d";
import { extractPostUrls } from "@/features/feed/lib/link-preview-resolver";
import { useLinkPreviews } from "@/features/feed/lib/use-link-previews";
import { SettingsSubcard } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

export function EddieLinkPreviews({ content }: { content: string }) {
  const { theme } = useAppTheme();
  const [debounced, setDebounced] = useState(content);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(content), 350);
    return () => clearTimeout(timer);
  }, [content]);
  const { embeds, loading } = useLinkPreviews(debounced);
  const currentUrls = extractPostUrls(content);
  const urls = extractPostUrls(debounced).filter(
    (url) => currentUrls.includes(url) && !dismissed.includes(url)
  );
  return (
    <View style={styles.list}>
      {urls.map((url) => {
        const embed = embeds.find((item) => item.url === url);
        return (
          <SettingsSubcard key={url} style={styles.card}>
            <Link2 size={15} color={theme.dividerText} />
            <View style={styles.copy}>
              <Text
                numberOfLines={1}
                style={[styles.title, { color: theme.inputText }]}
              >
                {embed?.title ?? (loading ? "Resolving link…" : "Link preview")}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.url, { color: theme.dividerText }]}
              >
                {url}
              </Text>
            </View>
            <IconButton3D
              accessibilityLabel={`Dismiss preview for ${url}`}
              icon={X}
              size={24}
              iconSize={12}
              onPress={() => setDismissed((current) => [...current, url])}
            />
          </SettingsSubcard>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { alignItems: "center", flexDirection: "row", gap: 8, padding: 10 },
  copy: { flex: 1, minWidth: 0 },
  list: { gap: 8, marginTop: 8 },
  title: { fontFamily: "SofiaProMed", fontSize: 12 },
  url: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 3 },
});
