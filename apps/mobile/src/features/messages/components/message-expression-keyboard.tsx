// oxlint-disable react/todo -- The current compiler lint cannot lower guarded native upload and API error paths.
import {
  STICKER_LIBRARY_MAX_ITEMS,
  isStickerSupportedMimeType,
  maxStickerInputBytes,
} from "@asm/media";
import {
  loadReactionCatalog,
  REACTION_CATEGORIES,
  searchReactionEmojis,
} from "@asm/messages";
import type { ReactionCatalog } from "@asm/messages";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { Star } from "lucide-react-native";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import addStickerArtwork from "@/assets/images/zeph-add-sticker.webp";
import { toast } from "@/components/feedback/toast";
import { GifPicker } from "@/components/media/gif-picker";
import type { KlipyGif } from "@/features/composer/lib/pick-media";
import { pickStickerSource } from "@/features/composer/lib/pick-media";
import { apiJson } from "@/features/media-upload/lib/upload-api";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { panel3d, reelsInput } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

import { MessageTilesSkeleton } from "./messages-skeleton";

type ExpressionTab = "emoji" | "gifs" | "stickers";
type StickerCollection = "mine" | "recent" | "favorites";

const EXPRESSION_TAB_LABEL: Record<ExpressionTab, string> = {
  emoji: "Emoji",
  gifs: "GIFs",
  stickers: "Stickers",
};

interface StickerItem {
  animated: boolean;
  byteSize: number;
  favorite: boolean;
  height: number;
  id: string;
  mediaId: string;
  name: string;
  thumbnailUrl: string;
  url: string;
  width: number;
}

interface StickerDelivery {
  animated: boolean;
  height: number;
  kind: "gif" | "image";
  mediaId: string;
  url: string;
  width: number;
}

interface StickerPage {
  items: StickerItem[];
  nextCursor: string | null;
}

interface StickerDraft {
  mediaId: string;
  name: string;
}

function fileStem(name: string): string {
  return name.replace(/\.[^.]+$/u, "").slice(0, 64);
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function requestStickerPage(
  collection: StickerCollection,
  cursor?: string
): Promise<StickerPage> {
  const query = new URLSearchParams({ collection, limit: "40" });
  if (cursor) {
    query.set("cursor", cursor);
  }
  return apiJson<StickerPage>(`/api/stickers?${query.toString()}`);
}

export function MessageExpressionKeyboard({
  canCreate,
  conversationId,
  disabled,
  incognitoSessionId,
  onEmoji,
  onGifSelect,
  onSendSticker,
  tab,
  onTabChange,
  stickersEnabled,
}: {
  canCreate: boolean;
  conversationId: string;
  disabled: boolean;
  incognitoSessionId?: string;
  onEmoji: (emoji: string) => void;
  onGifSelect: (gif: KlipyGif) => void;
  onSendSticker: (payload: MessagePayload) => Promise<void>;
  tab: ExpressionTab;
  onTabChange: (tab: ExpressionTab) => void;
  stickersEnabled: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  const input = reelsInput(isDark);
  const [catalog, setCatalog] = useState<ReactionCatalog | null>(null);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [emojiGroup, setEmojiGroup] = useState<number>(
    REACTION_CATEGORIES[0]?.id ?? 0
  );
  const [stickerCollection, setStickerCollection] =
    useState<StickerCollection>("mine");
  const [stickerPage, setStickerPage] = useState<StickerPage>({
    items: [],
    nextCursor: null,
  });
  const [loadedStickerCollection, setLoadedStickerCollection] =
    useState<StickerCollection | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [createStage, setCreateStage] = useState<string | null>(null);
  const [pendingSticker, setPendingSticker] = useState<StickerDraft | null>(
    null
  );
  const [stickerName, setStickerName] = useState("");
  const [sendingStickerId, setSendingStickerId] = useState<string | null>(null);
  const operationIds = useRef(new Map<string, string>());
  const emojiListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (tab !== "emoji") {
      return;
    }
    let active = true;
    const loadCatalog = async () => {
      try {
        const value = await loadReactionCatalog();
        if (active) {
          setCatalog(value);
        }
      } catch {
        if (active) {
          toast({
            description: "Please try again.",
            title: "Emojis unavailable",
            variant: "destructive",
          });
        }
      }
    };
    // oxlint-disable-next-line no-void -- Catalog errors are handled before the request settles.
    void loadCatalog();
    return () => {
      active = false;
    };
  }, [tab]);

  const loadStickerPage = useCallback(
    (cursor?: string) => requestStickerPage(stickerCollection, cursor),
    [stickerCollection]
  );

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "sticker-library-updated",
      () => setLoadedStickerCollection(null)
    );
    return () => subscription.remove();
  }, []);

  const stickersLoading = loadedStickerCollection !== stickerCollection;

  useEffect(() => {
    if (!stickersEnabled || loadedStickerCollection === stickerCollection) {
      return;
    }
    let active = true;
    const fetchStickerPage = async () => {
      try {
        const page = await requestStickerPage(stickerCollection);
        if (active) {
          setStickerPage(page);
        }
      } catch (error) {
        if (active) {
          toast({
            description: errorText(error, "Please try again."),
            title: "Stickers unavailable",
            variant: "destructive",
          });
        }
      } finally {
        if (active) {
          setLoadedStickerCollection(stickerCollection);
        }
      }
    };
    // oxlint-disable-next-line no-void -- The bounded request catches errors and ignores results after this tab unmounts.
    void fetchStickerPage();
    return () => {
      active = false;
    };
  }, [stickerCollection, stickersEnabled, loadedStickerCollection]);

  const emojis = useMemo(
    () =>
      catalog ? searchReactionEmojis(catalog, emojiQuery, emojiGroup) : [],
    [catalog, emojiGroup, emojiQuery]
  );

  const paginationRequest = useRef(false);
  const collectionRef = useRef(stickerCollection);
  useEffect(() => {
    collectionRef.current = stickerCollection;
  }, [stickerCollection]);
  const { height: viewportHeight } = useWindowDimensions();
  const loadMoreStickers = async () => {
    if (!stickerPage.nextCursor || paginationRequest.current) {
      return;
    }
    paginationRequest.current = true;
    const requestedCollection = stickerCollection;
    setLoadingMore(true);
    try {
      const next = await loadStickerPage(stickerPage.nextCursor);
      if (collectionRef.current !== requestedCollection) {
        return;
      }
      setStickerPage((current) => ({
        items: [
          ...current.items,
          ...next.items.filter(
            (item) => !current.items.some((existing) => existing.id === item.id)
          ),
        ],
        nextCursor: next.nextCursor,
      }));
    } catch (error) {
      toast({
        description: errorText(error, "Please try again."),
        title: "More stickers unavailable",
        variant: "destructive",
      });
    } finally {
      paginationRequest.current = false;
      setLoadingMore(false);
    }
  };

  const createSticker = async () => {
    if (creating || disabled || !canCreate) {
      return;
    }
    let source: PickedMedia | null;
    try {
      source = await pickStickerSource();
    } catch (error) {
      toast({
        description: errorText(error, "Please try again."),
        title: "Couldn't open files",
        variant: "destructive",
      });
      return;
    }
    if (!source) {
      return;
    }
    if (!isStickerSupportedMimeType(source.mimeType)) {
      toast({
        description: "Choose a JPEG, PNG, WebP, or GIF image.",
        title: "Unsupported sticker file",
        variant: "destructive",
      });
      return;
    }
    if (source.size > maxStickerInputBytes(source.mimeType)) {
      toast({
        description:
          source.mimeType === "image/gif"
            ? "GIFs can be up to 10 MiB."
            : "Images can be up to 5 MiB.",
        title: "Sticker file is too large",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    setCreateProgress(0);
    setCreateStage("Uploading sticker source");
    try {
      const upload = await uploadMedia(source, {
        onBytes: setCreateProgress,
        onStage: (stage) => setCreateStage(stage),
        purpose: "sticker",
        waitForProcessing: true,
      });
      if (upload.status !== "READY") {
        throw new Error("Sticker processing did not finish");
      }
      setPendingSticker({
        mediaId: upload.mediaId,
        name: fileStem(source.name),
      });
      setStickerName(fileStem(source.name));
      setCreateStage("Ready to save");
    } catch (error) {
      toast({
        description: errorText(error, "Please try a different file."),
        title: "Sticker creation failed",
        variant: "destructive",
      });
      setCreateStage(null);
    } finally {
      setCreating(false);
      setCreateProgress(0);
    }
  };

  const saveSticker = async () => {
    if (!pendingSticker || creating) {
      return;
    }
    setCreating(true);
    setCreateStage("Saving to My stickers");
    try {
      const saved = await apiJson<{ item: StickerItem }>("/api/stickers", {
        body: { mediaId: pendingSticker.mediaId, name: stickerName },
        method: "POST",
      });
      setPendingSticker(null);
      setStickerName("");
      setCreateStage(null);
      setStickerCollection("mine");
      if (stickerCollection === "mine") {
        setStickerPage((current) => ({
          ...current,
          items: [
            saved.item,
            ...current.items.filter((item) => item.id !== saved.item.id),
          ],
        }));
      }
    } catch (error) {
      toast({
        description: errorText(error, "Please try again."),
        title: "Sticker wasn't saved",
        variant: "destructive",
      });
      setCreateStage(null);
    } finally {
      setCreating(false);
    }
  };

  const sendSticker = async (sticker: StickerItem) => {
    if (disabled || sendingStickerId) {
      return;
    }
    setSendingStickerId(sticker.id);
    const operationId = operationIds.current.get(sticker.id) ?? randomUUID();
    operationIds.current.set(sticker.id, operationId);
    try {
      const delivery = await apiJson<StickerDelivery>(
        `/api/messages/conversations/${encodeURIComponent(conversationId)}/sticker-deliveries`,
        {
          body: {
            ...(incognitoSessionId ? { incognitoSessionId } : {}),
            operationId,
            stickerId: sticker.id,
          },
          method: "POST",
        }
      );
      await onSendSticker({
        height: delivery.height,
        kind: delivery.kind,
        presentation: "sticker",
        sticker: {
          animated: delivery.animated,
          mediaId: delivery.mediaId,
          version: 1,
        },
        type: "media",
        url: delivery.url,
        width: delivery.width,
      });
      operationIds.current.delete(sticker.id);
    } catch (error) {
      toast({
        description: errorText(error, "Please try again."),
        title: "Sticker wasn't sent",
        variant: "destructive",
      });
    } finally {
      setSendingStickerId(null);
    }
  };

  const textColor = isDark ? "#f1f1f1" : "#202020";
  const mutedColor = theme.dividerText;
  const visibleTab = !stickersEnabled && tab === "stickers" ? "emoji" : tab;
  let emojiResults: ReactNode;
  if (!catalog) {
    emojiResults = <MessageTilesSkeleton label="Loading emojis" compact />;
  } else if (emojis.length === 0) {
    emojiResults = (
      <Text style={[styles.empty, { color: mutedColor }]}>No emojis found</Text>
    );
  } else {
    emojiResults = (
      <FlatList
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        data={emojis}
        initialNumToRender={48}
        keyExtractor={(item) => item.emoji}
        keyboardShouldPersistTaps="handled"
        numColumns={8}
        ref={emojiListRef}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="button"
            onPress={() => onEmoji(item.emoji)}
            style={styles.emojiCell}
          >
            <Text style={styles.emoji}>{item.emoji}</Text>
          </Pressable>
        )}
        style={styles.emojiList}
      />
    );
  }

  let stickerResults: ReactNode;
  if (!canCreate && !stickersLoading && stickerPage.items.length === 0) {
    const emptyTitle =
      stickerCollection === "mine"
        ? "Your sticker shelf is empty"
        : "No stickers here yet";
    const emptyDescription =
      stickerCollection === "mine"
        ? "Create one from an image or GIF and keep it for your chats."
        : "Stickers you send will show up here.";
    stickerResults = (
      <View style={styles.empty}>
        <Text
          style={{
            color: textColor,
            fontSize: 14,
            fontWeight: "600",
            textAlign: "center",
          }}
        >
          {emptyTitle}
        </Text>
        <Text
          style={{
            color: mutedColor,
            fontSize: 12,
            marginTop: 4,
            textAlign: "center",
          }}
        >
          {emptyDescription}
        </Text>
      </View>
    );
  } else {
    stickerResults = (
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent }) => {
          if (
            nativeEvent.contentOffset.y +
              nativeEvent.layoutMeasurement.height >=
            nativeEvent.contentSize.height - 200
          ) {
            void loadMoreStickers();
          }
        }}
        scrollEventThrottle={100}
        style={styles.stickerScroll}
      >
        <View style={styles.stickerGrid}>
          {canCreate ? (
            <Pressable
              accessibilityLabel="Add sticker"
              accessibilityRole="button"
              disabled={disabled || creating}
              onPress={createSticker}
              style={({ pressed }) => [
                styles.stickerTile,
                styles.addStickerTile,
                pressed && styles.pressed,
                (disabled || creating) && { opacity: 0.5 },
              ]}
            >
              <Image
                accessible={false}
                source={addStickerArtwork}
                contentFit="contain"
                style={styles.addStickerImage}
              />
              <Text
                style={{
                  color: mutedColor,
                  fontSize: 11,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                Add sticker
              </Text>
            </Pressable>
          ) : null}
          {(stickersLoading ? [] : stickerPage.items).map((sticker) => (
            <View key={sticker.id} style={styles.stickerTile}>
              <Pressable
                accessibilityLabel={`Send sticker ${sticker.name || "sticker"}`}
                accessibilityRole="button"
                disabled={disabled || sendingStickerId !== null}
                onPress={() => sendSticker(sticker)}
                style={({ pressed }) => [
                  styles.stickerButton,
                  pressed && styles.pressed,
                ]}
              >
                <Image
                  contentFit="contain"
                  source={{ uri: sticker.thumbnailUrl }}
                  style={styles.stickerImage}
                />
              </Pressable>
              {sticker.favorite ? (
                <View
                  pointerEvents="none"
                  style={{ bottom: 4, left: 4, position: "absolute" }}
                >
                  <Star color="#e4a324" fill="#e4a324" size={16} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
        {stickersLoading ? (
          <MessageTilesSkeleton label="Loading stickers" />
        ) : null}
        {!stickersLoading && stickerPage.items.length === 0 && canCreate ? (
          <Text style={{ color: mutedColor, fontSize: 12, marginTop: 12 }}>
            Make a sticker from an image or GIF.
          </Text>
        ) : null}
        {loadingMore ? <MessageTilesSkeleton label="Loading stickers" /> : null}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.panel,
        { height: Math.min(420, viewportHeight * 0.52), overflow: "hidden" },
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
        },
      ]}
    >
      <View
        accessibilityLabel="Message expressions"
        accessibilityRole="tablist"
        style={[styles.tabs, { backgroundColor: input.background }]}
      >
        {(stickersEnabled
          ? (["emoji", "gifs", "stickers"] as const)
          : (["emoji", "gifs"] as const)
        ).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: visibleTab === value }}
            disabled={disabled && value !== "emoji"}
            key={value}
            onPress={() => onTabChange(value)}
            style={[
              styles.tab,
              visibleTab === value && {
                backgroundColor: panel.background,
                boxShadow: panel.shadows,
              },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: visibleTab === value ? textColor : mutedColor },
              ]}
            >
              {EXPRESSION_TAB_LABEL[value]}
            </Text>
          </Pressable>
        ))}
      </View>

      {visibleTab === "emoji" && (
        <View style={{ flex: 1, minHeight: 0 }}>
          <TextInput
            accessibilityLabel="Search emojis"
            onChangeText={setEmojiQuery}
            placeholder="Search emojis"
            placeholderTextColor={mutedColor}
            style={[
              styles.search,
              { backgroundColor: input.background, color: textColor },
            ]}
            value={emojiQuery}
          />
          {emojiQuery.trim() ? null : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
            >
              {REACTION_CATEGORIES.map((category) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: emojiGroup === category.id }}
                  key={category.id}
                  onPress={() => {
                    setEmojiGroup(category.id);
                    emojiListRef.current?.scrollToOffset({
                      animated: false,
                      offset: 0,
                    });
                  }}
                  style={[
                    styles.category,
                    { borderColor: theme.dividerLine },
                    emojiGroup === category.id && {
                      backgroundColor: input.background,
                    },
                  ]}
                >
                  <Text style={{ color: textColor, fontSize: 11 }}>
                    {category.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {emojiResults}
        </View>
      )}
      {visibleTab === "gifs" && (
        <GifPicker disabled={disabled} onSelect={onGifSelect} />
      )}
      {visibleTab === "stickers" && stickersEnabled && (
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={styles.stickerToolbar}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.collectionRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {(["mine", "recent", "favorites"] as const).map((value) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: stickerCollection === value }}
                  key={value}
                  onPress={() => setStickerCollection(value)}
                  style={[
                    styles.collection,
                    { borderColor: theme.dividerLine },
                    stickerCollection === value && {
                      backgroundColor: input.background,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: textColor,
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {value === "mine" ? "My stickers" : value}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {createStage || pendingSticker ? (
            <View
              style={[styles.createStatus, { borderColor: theme.dividerLine }]}
            >
              <Text
                numberOfLines={1}
                style={{ color: mutedColor, flex: 1, fontSize: 12 }}
              >
                {createStage ?? "Ready to save"}
              </Text>
              {creating && createProgress > 0 ? (
                <Text style={{ color: mutedColor, fontSize: 12 }}>
                  {Math.round(createProgress)}%
                </Text>
              ) : null}
              {pendingSticker ? (
                <>
                  <TextInput
                    accessibilityLabel="Sticker name"
                    maxLength={64}
                    onChangeText={setStickerName}
                    placeholder="Sticker name"
                    placeholderTextColor={mutedColor}
                    style={[
                      styles.nameInput,
                      {
                        backgroundColor: input.background,
                        color: textColor,
                      },
                    ]}
                    value={stickerName}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={creating}
                    onPress={saveSticker}
                    style={styles.saveButton}
                  >
                    <Text
                      style={{
                        color: textColor,
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      Save
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {stickerResults}
          {incognitoSessionId && canCreate ? (
            <Text style={[styles.incognitoNotice, { color: mutedColor }]}>
              Sticker creation is unavailable in incognito chats.
            </Text>
          ) : null}
          <Text style={[styles.limitNote, { color: mutedColor }]}>
            Up to {STICKER_LIBRARY_MAX_ITEMS.toLocaleString()} saved stickers
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  addStickerImage: { flex: 1, minHeight: 0, opacity: 0.75, width: "100%" },
  addStickerTile: {
    alignItems: "center",
    aspectRatio: 1,
    gap: 2,
    justifyContent: "center",
    padding: 4,
  },
  category: {
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryScroll: {
    flexGrow: 0,
    marginBottom: 5,
    marginTop: 7,
  },
  collection: {
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  collectionRow: {
    alignItems: "center",
    gap: 6,
    paddingRight: 8,
  },
  createButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: "center",
    width: 42,
  },
  createStatus: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    marginBottom: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  emoji: {
    fontSize: 25,
  },
  emojiCell: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: "12.5%",
  },
  emojiList: {
    height: 180,
  },
  empty: {
    alignItems: "center",
    height: 156,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  incognitoNotice: {
    fontSize: 11,
    marginTop: 4,
  },
  limitNote: {
    fontSize: 10,
    marginTop: 4,
    textAlign: "right",
  },
  loadMore: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginBottom: 4,
    marginTop: 5,
    minHeight: 40,
  },
  nameInput: {
    borderRadius: 9,
    flex: 1,
    fontSize: 12,
    minHeight: 34,
    paddingHorizontal: 8,
  },
  panel: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    marginHorizontal: 3,
    padding: 9,
  },
  pressed: {
    opacity: 0.72,
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 7,
  },
  search: {
    borderRadius: 10,
    fontSize: 13,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  stickerButton: {
    alignItems: "center",
    aspectRatio: 1,
    borderRadius: 12,
    justifyContent: "center",
    padding: 4,
    width: "100%",
  },
  stickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  stickerImage: {
    height: 56,
    width: 56,
  },
  stickerScroll: {
    flex: 1,
  },
  stickerTile: {
    borderRadius: 12,
    flexBasis: "23%",
    minWidth: 56,
    overflow: "hidden",
    position: "relative",
  },
  stickerToolbar: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 8,
  },
  tab: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  tabs: {
    borderRadius: 13,
    flexDirection: "row",
    gap: 3,
    marginBottom: 8,
    padding: 3,
  },
});
