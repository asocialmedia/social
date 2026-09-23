// Web's VideoTranscriptDrawer, rendered inside the gust card: a bottom sheet
// on black/95 (rounded-t-3xl, white/15 top hairline, min 320 / max 75%)
// springing up from below (damping 28, stiffness 280). Grab handle, Zeph
// header with "Tap any sentence to seek video", a Copy pill that turns
// emerald "Copied" for 2s, an X, a search field, and the cue list: mono
// timestamp chips (orange gradient when live), the live row outlined in
// orange, tap to seek and play.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Copy, Search, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import zephImage from "@/assets/images/zeph.png";
import { toast } from "@/components/feedback/toast";
import type { TranscriptCue } from "@/features/feed/lib/transcript-cues";
import { logWarn } from "@/lib/telemetry";

import {
  filterCues,
  formatCueTime,
  isCueActive,
  transcriptCopyText,
} from "../lib/transcript-view";

// expo-clipboard is a native module: an install that predates the dev
// build would throw at import, so it loads lazily and falls back to the
// system share sheet.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(text);
    return true;
  } catch (error) {
    logWarn("gusts.clipboard_unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    try {
      await Share.share({ message: text });
    } catch {
      // Dismissing the share sheet is not an error.
    }
    return false;
  }
}

function SpinningRing() {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        duration: 800,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  return (
    <Animated.View
      style={[
        styles.ring,
        {
          transform: [
            {
              rotate: turn.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export function TranscriptDrawer({
  cues,
  currentTime,
  loading,
  onClose,
  onSeek,
  rawTranscript,
}: {
  cues: readonly TranscriptCue[];
  currentTime: number;
  loading: boolean;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  rawTranscript: string | null | undefined;
}) {
  const window = useWindowDimensions();
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [slide] = useState(() => new Animated.Value(0));
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.spring(slide, {
      damping: 28,
      mass: 1,
      stiffness: 280,
      toValue: 1,
      useNativeDriver: true,
    }).start();
    return () => {
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, [slide]);

  const close = () => {
    Animated.spring(slide, {
      damping: 28,
      mass: 1,
      stiffness: 280,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const visible = useMemo(() => filterCues(cues, query), [cues, query]);
  const maxHeight = window.height * 0.75;

  const copy = () => {
    const text = transcriptCopyText(cues, rawTranscript);
    if (!text) {
      return;
    }
    void (async () => {
      const done = await copyToClipboard(text);
      if (!done) {
        return;
      }
      setCopied(true);
      toast({ title: "Transcript copied to clipboard" });
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    })();
  };

  let body;
  if (loading) {
    body = (
      <View style={styles.center}>
        <SpinningRing />
      </View>
    );
  } else if (cues.length === 0 && rawTranscript?.trim()) {
    body = (
      <ScrollView contentContainerStyle={styles.rawWrap}>
        <Text style={styles.rawText}>{rawTranscript.trim()}</Text>
      </ScrollView>
    );
  } else if (cues.length === 0) {
    body = (
      <View style={styles.center}>
        <Image
          accessibilityLabel=""
          contentFit="contain"
          source={zephImage}
          style={styles.emptyArt}
        />
        <Text style={styles.emptyText}>
          No transcript available for this video
        </Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        {visible.map((cue) => {
          const live = isCueActive(cue, currentTime);
          return (
            <Pressable
              accessibilityLabel={`Seek to ${formatCueTime(cue.start)}`}
              accessibilityRole="button"
              key={`${cue.start}-${cue.text}`}
              onPress={() => onSeek(cue.start)}
              style={[styles.row, live && styles.rowLive]}
            >
              {live ? (
                <LinearGradient
                  colors={["#ff9500", "#e65500"]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.stamp}
                >
                  <Text style={styles.stampText}>
                    {formatCueTime(cue.start)}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={[styles.stamp, styles.stampIdle]}>
                  <Text style={[styles.stampText, styles.stampTextIdle]}>
                    {formatCueTime(cue.start)}
                  </Text>
                </View>
              )}
              <Text style={[styles.cueText, live && styles.cueTextLive]}>
                {cue.text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          maxHeight,
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [maxHeight, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.handle} />
      <View style={styles.header}>
        <Image
          accessibilityLabel=""
          contentFit="contain"
          source={zephImage}
          style={styles.zeph}
        />
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Transcript</Text>
          <Text style={styles.subtitle}>Tap any sentence to seek video</Text>
        </View>
        <Pressable
          accessibilityLabel="Copy transcript"
          accessibilityRole="button"
          onPress={copy}
          style={[styles.copyBtn, copied && styles.copyBtnDone]}
        >
          {copied ? (
            <Check color="#6ee7b7" size={14} />
          ) : (
            <Copy color="#ffffff" size={14} />
          )}
          <Text style={[styles.copyText, copied && styles.copyTextDone]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Close transcript"
          accessibilityRole="button"
          hitSlop={6}
          onPress={close}
          style={styles.closeBtn}
        >
          <X color="#ffffff" size={16} />
        </Pressable>
      </View>
      {cues.length > 0 ? (
        <View style={styles.search}>
          <Search color="rgba(255, 255, 255, 0.5)" size={14} />
          <TextInput
            accessibilityLabel="Search in transcript"
            onChangeText={setQuery}
            placeholder="Search in transcript..."
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
            style={styles.searchInput}
            value={query}
          />
        </View>
      ) : null}
      {body}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    paddingVertical: 40,
  },
  closeBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  copyBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
  },
  copyBtnDone: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
  },
  copyText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  copyTextDone: {
    color: "#6ee7b7",
  },
  cueText: {
    color: "rgba(255, 255, 255, 0.8)",
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 20,
  },
  cueTextLive: {
    color: "#ffffff",
  },
  emptyArt: {
    height: 64,
    opacity: 0.5,
    width: 64,
  },
  emptyText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 9999,
    height: 4,
    marginBottom: 8,
    marginTop: 10,
    width: 40,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerCopy: {
    flex: 1,
  },
  list: {
    gap: 4,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  rawText: {
    color: "rgba(255, 255, 255, 0.85)",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 22,
  },
  rawWrap: {
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  ring: {
    borderColor: "#ff9500",
    borderRadius: 9999,
    borderTopColor: "transparent",
    borderWidth: 2,
    height: 20,
    width: 20,
  },
  row: {
    alignItems: "flex-start",
    borderColor: "transparent",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  rowLive: {
    backgroundColor: "rgba(249, 115, 22, 0.15)",
    borderColor: "#f97316",
  },
  search: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: "#ffffff",
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    height: 40,
  },
  sheet: {
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    minHeight: 320,
    position: "absolute",
    right: 0,
    zIndex: 70,
  },
  stamp: {
    alignItems: "center",
    borderRadius: 6,
    minWidth: 40,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stampIdle: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  stampText: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 11,
  },
  stampTextIdle: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.55)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  title: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 15,
    fontWeight: "normal",
  },
  zeph: {
    height: 34,
    width: 34,
  },
});
