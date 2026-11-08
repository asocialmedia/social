// oxlint-disable react/exhaustive-effect-dependencies -- Retry revisions reload the catalog; query/category changes reset the scroll position.
import {
  loadReactionCatalog,
  QUICK_MESSAGE_REACTIONS,
  REACTION_CATEGORIES,
  searchReactionEmojis,
} from "@asm/messages";
import type { ReactionCatalog, ReactionEmoji } from "@asm/messages";
import { ArrowLeft, Plus, Search, X } from "lucide-react-native";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ZephLoader } from "@/components/feedback/zeph-loader";
import { panel3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

import { EmojiSkinTonePicker } from "./emoji-skin-tone-picker";

export function MessageReactionSheet({
  onClose,
  onReact,
}: {
  onClose: () => void;
  onReact: (emoji: string) => void;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(0);
  const [tone, setTone] = useState(0);
  const [catalog, setCatalog] = useState<ReactionCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef<FlatList<ReactionEmoji>>(null);
  const deferred = useDeferredValue(query);
  useEffect(() => {
    if (!expanded) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const value = await loadReactionCatalog();
        if (active) {
          setCatalog(value);
          setFailed(false);
        }
      } catch {
        if (active) {
          setFailed(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, expanded]);
  const results = catalog
    ? searchReactionEmojis(catalog, deferred, group, tone)
    : [];
  useEffect(() => {
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  }, [deferred, group]);
  const iconStyle = { color: theme.inputText };

  let empty = (
    <Text style={[styles.empty, { color: theme.dividerText }]}>
      No emojis found
    </Text>
  );
  if (!catalog && failed) {
    empty = (
      <Pressable
        accessibilityRole="button"
        onPress={() => setAttempt((value) => value + 1)}
        style={styles.empty}
      >
        <Text style={{ color: theme.inputText }}>Retry loading emojis</Text>
      </Pressable>
    );
  }
  if (!catalog && !failed) {
    empty = <ZephLoader variant="messages" style={styles.empty} />;
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={expanded ? () => setExpanded(false) : onClose}
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel="Dismiss reactions"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
              maxHeight: "85%",
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.header}>
            {expanded ? (
              <Pressable
                accessibilityLabel="Back to quick reactions"
                accessibilityRole="button"
                onPress={() => setExpanded(false)}
                style={styles.icon}
              >
                <ArrowLeft {...iconStyle} size={19} />
              </Pressable>
            ) : null}
            <Text style={[styles.title, { color: theme.inputText }]}>
              Reactions
            </Text>
            {expanded ? (
              <EmojiSkinTonePicker
                disabled={!catalog}
                onChange={setTone}
                tone={tone}
              />
            ) : null}
            <Pressable
              accessibilityLabel="Close reactions"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.icon}
            >
              <X {...iconStyle} size={19} />
            </Pressable>
          </View>
          {expanded ? (
            <>
              <View
                style={[
                  styles.search,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.inputBorder,
                  },
                ]}
              >
                <Search color={theme.inputPlaceholder} size={17} />
                <TextInput
                  accessibilityLabel="Search emojis"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={80}
                  onChangeText={setQuery}
                  placeholder="Search emojis"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={[styles.searchInput, { color: theme.inputText }]}
                  value={query}
                />
              </View>
              <ScrollView
                contentContainerStyle={styles.categories}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
              >
                {REACTION_CATEGORIES.map((category) => (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{
                      selected: group === category.id && !query,
                    }}
                    key={category.id}
                    onPress={() => {
                      setGroup(category.id);
                      setQuery("");
                    }}
                    style={[
                      styles.category,
                      group === category.id &&
                        !query && { backgroundColor: theme.inputBg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        {
                          color:
                            group === category.id
                              ? theme.inputText
                              : theme.dividerText,
                        },
                      ]}
                    >
                      {category.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <FlatList
                data={results}
                initialNumToRender={48}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(entry) => entry.emoji}
                ListEmptyComponent={empty}
                numColumns={6}
                ref={listRef}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityLabel={`React with ${item.label}`}
                    accessibilityRole="button"
                    onPress={() => onReact(item.emoji)}
                    style={({ pressed }) => [
                      styles.cell,
                      pressed && { backgroundColor: theme.inputBg },
                    ]}
                  >
                    <Text style={styles.emoji}>{item.emoji}</Text>
                  </Pressable>
                )}
                style={styles.grid}
                windowSize={5}
              />
            </>
          ) : (
            <View style={styles.quick}>
              {QUICK_MESSAGE_REACTIONS.map((emoji) => (
                <Pressable
                  accessibilityLabel={`React with ${emoji}`}
                  accessibilityRole="button"
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  style={({ pressed }) => [
                    styles.cell,
                    pressed && { backgroundColor: theme.inputBg },
                  ]}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="More reactions"
                accessibilityRole="button"
                onPress={() => setExpanded(true)}
                style={styles.cell}
              >
                <View
                  style={[styles.more, { borderColor: theme.inputPlaceholder }]}
                >
                  <Plus color={theme.dividerText} size={18} />
                </View>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  categories: { gap: 4 },
  category: {
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  categoryScroll: { flexGrow: 0, marginVertical: 8 },
  categoryText: { fontFamily: "SofiaProMed", fontSize: 12 },
  cell: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    height: 48,
    justifyContent: "center",
    maxWidth: "16.6667%",
  },
  emoji: { fontSize: 26 },
  empty: { paddingVertical: 50, textAlign: "center" },
  grid: { flexGrow: 0, flexShrink: 1, height: 288 },
  header: { alignItems: "center", flexDirection: "row", paddingVertical: 4 },
  icon: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  more: {
    alignItems: "center",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  overlay: {
    backgroundColor: "#00000055",
    flex: 1,
    justifyContent: "flex-end",
  },
  panel: {
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    marginHorizontal: 8,
    maxWidth: 440,
    paddingHorizontal: 12,
    width: "96%",
  },
  quick: { flexDirection: "row", paddingVertical: 8 },
  search: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontFamily: "SofiaProReg", fontSize: 16, height: 44 },
  title: { flex: 1, fontFamily: "SofiaProMed", fontSize: 16, paddingLeft: 8 },
});
