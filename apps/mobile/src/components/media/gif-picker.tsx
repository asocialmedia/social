// KLIPY GIF picker, port of web's klipy-gif-picker.tsx: a reels-input search
// field ("Search KLIPY", clear X), trending results by default, search after
// a 350ms pause, a 4-column grid capped at 256px with pulse skeletons while
// loading, and the empty/error copy from web. Selecting reports the GIF; the
// caller downloads and uploads it like any other attachment.
import { Image } from "expo-image";
import { Search, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { themeText } from "@/components/surface/recipes";
import type { KlipyGif } from "@/features/composer/lib/pick-media";
import { apiJson } from "@/features/media-upload/lib/upload-api";
import { useAppTheme } from "@/theme";

const PLACEHOLDER = "Search KLIPY";

// `.reels-panel` and `.reels-input`, light + dark.
export function reelsPanel(isDark: boolean) {
  return isDark
    ? {
        background: "#171717",
        border: "rgba(255, 255, 255, 0.12)",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.2)",
      }
    : {
        background: "#f3f4f6",
        border: "rgba(0, 0, 0, 0.12)",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06), 0 6px 20px rgba(0, 0, 0, 0.12)",
      };
}

function reelsInput(isDark: boolean) {
  return isDark
    ? {
        background: "#232323",
        border: "rgba(255, 255, 255, 0.1)",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.2)",
      }
    : {
        background: "#f9f9f9",
        border: "rgba(0, 0, 0, 0.12)",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -2px 4px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06)",
      };
}

export function GifPicker({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (gif: KlipyGif) => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const input = reelsInput(isDark);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<KlipyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void (async () => {
          try {
            const data = await apiJson<{ gifs?: KlipyGif[] }>(
              trimmed
                ? `/api/gifs/search?q=${encodeURIComponent(trimmed)}`
                : "/api/gifs/trending"
            );
            if (!cancelled) {
              setGifs(data.gifs ?? []);
              setFailed(false);
            }
          } catch {
            if (!cancelled) {
              setGifs([]);
              setFailed(Boolean(trimmed));
            }
          }
          if (!cancelled) {
            setLoading(false);
          }
        })();
      },
      trimmed ? 350 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  let grid: React.ReactNode;
  if (loading) {
    grid = Array.from({ length: 8 }, (_, index) => (
      <View
        key={`gif-skeleton-${index}`}
        style={[
          styles.cell,
          {
            backgroundColor: isDark
              ? "rgba(48, 48, 48, 0.6)"
              : "rgba(232, 232, 232, 0.6)",
          },
        ]}
      />
    ));
  } else if (gifs.length === 0) {
    grid = (
      <Text style={[styles.empty, { color: text.muted }]}>
        {failed
          ? "Couldn't search GIFs right now, try again?"
          : `No GIFs found for “${query}”`}
      </Text>
    );
  } else {
    grid = gifs.map((gif) => (
      <Pressable
        accessibilityLabel={`Select GIF: ${gif.title || "untitled"}`}
        accessibilityRole="button"
        disabled={disabled}
        key={String(gif.id)}
        onPress={() => onSelect(gif)}
        style={({ pressed }) => [
          styles.cell,
          {
            backgroundColor: isDark
              ? "rgba(48, 48, 48, 0.4)"
              : "rgba(232, 232, 232, 0.4)",
          },
          pressed && styles.cellPressed,
        ]}
      >
        <Image
          accessibilityLabel={gif.title || "GIF"}
          contentFit="cover"
          source={{ uri: gif.preview }}
          style={StyleSheet.absoluteFill}
        />
      </Pressable>
    ));
  }

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.search,
          {
            backgroundColor: input.background,
            borderColor: input.border,
            boxShadow: input.shadows,
          },
        ]}
      >
        <Search color={text.muted} size={16} />
        <TextInput
          accessibilityLabel={PLACEHOLDER}
          onChangeText={setQuery}
          placeholder={PLACEHOLDER}
          placeholderTextColor={text.muted}
          style={[styles.searchField, { color: text.foreground }]}
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setQuery("")}
          >
            <X color={text.muted} size={14} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.grid}
        nestedScrollEnabled
        style={styles.gridScroll}
      >
        {grid}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    aspectRatio: 1,
    borderRadius: 8,
    overflow: "hidden",
    width: "23.5%",
  },
  cellPressed: {
    boxShadow:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.3), 0 0 0 1px rgba(170, 60, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3)",
    transform: [{ scale: 1.03 }],
  },
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    paddingVertical: 48,
    textAlign: "center",
    width: "100%",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  gridScroll: {
    maxHeight: 256,
  },
  search: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
  },
  searchField: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minWidth: 0,
    padding: 0,
  },
  wrap: {
    gap: 8,
    width: "100%",
  },
});
