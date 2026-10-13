import { Host, Slider, Switch } from "@expo/ui";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { BellOff, ChevronDown, Palette, UserRound } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";

import chatDoodle from "@/assets/images/chat-doodle.webp";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { authClient } from "@/features/auth/lib/auth-client";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import {
  fetchDenInformation,
  fetchSharedConversationItems,
  hydrateSearchHits,
  leaveDen,
  setConversationWallpaperUpload,
  updateConversationPrefs,
} from "@/features/messages/lib/client";
import type {
  ConversationPrefs,
  DenInformation,
  SharedConversationPage,
} from "@/features/messages/lib/client";
import {
  conversationKind,
  conversationLeft,
  conversationName,
} from "@/features/messages/lib/conversation-presentation";
import { CONVERSATION_THEMES } from "@/features/messages/lib/conversation-theme";
import {
  decryptMessageWithBaseKey,
  getMediaImages,
} from "@/features/messages/lib/crypto";
import { surface3d } from "@/features/messages/lib/message-recipes";
import type { MessageConversationData } from "@/features/messages/lib/types";
import {
  pickProfileImage,
  stabilizePickedImage,
} from "@/features/profile/lib/profile-media";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { DenAvatar } from "./den-avatar";
import { DenRoster } from "./den-roster";
import { DenSettings } from "./den-settings";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessagePostPreview } from "./message-post-preview";
import { MessageSheet } from "./message-sheet";
import { MessageImage } from "./messages-primitives";

export function ConversationDetails({
  conversation,
  userId,
  prefs,
  getBaseKeys,
  onPrefs,
  onClose,
  onJump,
  onRefresh,
}: {
  conversation: MessageConversationData;
  userId: string;
  prefs: ConversationPrefs;
  getBaseKeys: (id: string) => Promise<Uint8Array[]>;
  onPrefs: (prefs: ConversationPrefs) => void;
  onClose: () => void;
  onJump: (id: string) => void;
  onRefresh: () => void;
}) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const [tab, setTab] = useState(
    conversationKind(conversation) === "DEN" ? "members" : "details"
  );
  const [themeOpen, setThemeOpen] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [kind, setKind] = useState<"media" | "post" | "link">("media");
  const [den, setDen] = useState<DenInformation | null>(null);
  const [denError, setDenError] = useState<string | null>(null);
  const [denRevision, setDenRevision] = useState(0);
  const [shared, setShared] = useState<SharedConversationPage | null>(null);
  const [references, setReferences] = useState<
    {
      key: string;
      messageId: string;
      url: string | null;
      label: string;
      postId: string | null;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dim, setDim] = useState(prefs.wallpaperDim ?? 40);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [sharedRevision, setSharedRevision] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const pending = useRef(false);
  const isDen = conversationKind(conversation) === "DEN";
  const peer = conversation.members.find(
    (member) => member.userId !== userId
  )?.user;
  const activeMembers = conversation.members.filter((member) => !member.leftAt);
  const title = conversationName(conversation, userId);
  const panel = surface3d(isDark);

  // oxlint-disable react/exhaustive-effect-dependencies -- membership and metadata changes refresh manager permissions and invite values
  useEffect(() => {
    if (!isDen || denRevision < 0) {
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const result = await fetchDenInformation(conversation.id, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setDen(result);
          setDenError(null);
        }
      } catch {
        if (active) {
          setDenError("Couldn't load den details. Try again.");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [
    conversation.id,
    conversation.updatedAt,
    conversation.membershipSeq,
    isDen,
    denRevision,
  ]);
  // oxlint-enable react/exhaustive-effect-dependencies
  useEffect(() => {
    if (sharedRevision < 0 || tab !== "shared") {
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        const page = await fetchSharedConversationItems(
          conversation.id,
          kind,
          options,
          cursor,
          controller.signal
        );
        const ids = new Map(
          page.items.map((item) => [
            item.messageId,
            { id: item.messageId, revision: item.revision },
          ])
        );
        const hydrated = await hydrateSearchHits(
          conversation.id,
          [...ids.values()],
          options,
          controller.signal
        );
        const keys = await getBaseKeys(conversation.id);
        const rows: typeof references = [];
        for (const item of page.items) {
          const message = hydrated.messages.find(
            (row) => row.id === item.messageId
          );
          if (!message || message.deletedAt) {
            continue;
          }
          for (const key of keys) {
            try {
              const payload = decryptMessageWithBaseKey(
                key,
                message.senderId,
                conversation.id,
                message
              );
              let url: string | null = null;
              let postId: string | null = null;
              let label = payload.content ?? "Shared item";
              if (kind === "media" && payload.type === "media") {
                url = getMediaImages(payload)[item.ordinal]?.url ?? null;
                label = payload.content || "Shared image";
              }
              if (kind === "post") {
                postId =
                  payload.type === "post" ? payload.postId : item.requiredId;
                label = payload.content || "Shared post";
              }
              if (kind === "link") {
                const links =
                  payload.content?.match(/https?:\/\/[^\s<>]+/g) ?? [];
                url = links[item.ordinal] ?? null;
                label = url ?? "Shared link";
              }
              rows.push({
                key: `${item.messageId}:${item.ordinal}`,
                label,
                messageId: item.messageId,
                postId,
                url,
              });
              break;
            } catch {
              // A different readable epoch may own this reference.
            }
          }
        }
        if (!controller.signal.aborted) {
          setShared(page);
          setReferences(rows);
          if (
            hydrated.deferredIds.length ||
            hydrated.unavailableIds.length ||
            rows.length < page.items.length
          ) {
            setError("Some shared items could not be read. Try again.");
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Couldn't load shared items. Please try again.");
        }
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [conversation.id, cursor, getBaseKeys, kind, tab, sharedRevision]);
  const handleWritePrefs = async (
    patch: Parameters<typeof updateConversationPrefs>[1]
  ) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await updateConversationPrefs(conversation.id, patch, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      onPrefs(next);
    } catch {
      setError("Couldn't save this change. Your previous setting is kept.");
    }
    pending.current = false;
    setBusy(false);
  };
  const handleDim = (value: number) => {
    setDim(value);
    if (dimTimer.current) {
      clearTimeout(dimTimer.current);
    }
    dimTimer.current = setTimeout(() => {
      void handleWritePrefs({ wallpaperDim: value });
    }, 350);
  };
  const handleUploadWallpaper = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickProfileImage("banner");
      if (picked) {
        const uploaded = await uploadMedia(
          stabilizePickedImage(picked).source,
          {
            conversationId: conversation.id,
            purpose: "wallpaper",
            waitForProcessing: true,
          }
        );
        const next = await setConversationWallpaperUpload(
          conversation.id,
          uploaded.mediaId,
          { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() }
        );
        onPrefs(next.prefs);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't upload this wallpaper. Try again."
      );
    }
    pending.current = false;
    setBusy(false);
  };
  const handleRemoveWallpaper = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const next = await setConversationWallpaperUpload(conversation.id, null, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      onPrefs(next.prefs);
    } catch {
      setError("Couldn't remove your wallpaper. Try again.");
    }
    pending.current = false;
    setBusy(false);
  };
  const handleLeave = () =>
    Alert.alert(
      "Leave den?",
      "Your history stays readable, but you won't receive new messages.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            const leave = async () => {
              try {
                await leaveDen(conversation.id, {
                  apiBase: getApiBaseUrl(),
                  cookie: await authClient.getCookie(),
                });
                onClose();
                onRefresh();
              } catch {
                setError("Couldn't leave this den. Try again.");
              }
            };
            void leave();
          },
          style: "destructive",
          text: "Leave",
        },
      ]
    );
  const handleOpenReference = (reference: (typeof references)[number]) => {
    if (kind === "media" && reference.url) {
      setViewerIndex(
        references
          .filter((row) => row.url)
          .findIndex((row) => row.key === reference.key)
      );
      return;
    }
    if (reference.postId) {
      onClose();
      router.push({
        params: { postId: reference.postId },
        pathname: "/posts/[postId]",
      });
      return;
    }
    if (kind === "link" && reference.url) {
      const open = async () => {
        try {
          await Linking.openURL(reference.url ?? "");
        } catch {
          setError("Couldn't open this link.");
        }
      };
      void open();
      return;
    }
    onClose();
    onJump(reference.messageId);
  };
  let sharedHint: string | null = null;
  if (loading) {
    sharedHint = "Loading shared items…";
  } else if (references.length === 0) {
    sharedHint = shared?.coverageComplete
      ? "No shared items yet"
      : "Shared history isn't available yet. Try again shortly.";
  }
  useEffect(
    () => () => {
      if (dimTimer.current) {
        clearTimeout(dimTimer.current);
      }
    },
    []
  );

  return (
    <MessageSheet
      title={title}
      open
      onClose={onClose}
      busy={busy}
      overlay={
        <MessageMediaViewer
          images={references.flatMap((row) => (row.url ? [row.url] : []))}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      }
    >
      <View style={{ gap: 6 }}>
        <View
          style={{
            backgroundColor: theme.containerBg,
            borderRadius: 16,
            height: 96,
            overflow: "hidden",
          }}
        >
          {isDen ? (
            <LinearGradient
              colors={["#ff9500", "#e65500", "#8b2f00"]}
              style={{ height: 96, width: "100%" }}
            />
          ) : null}
          {!isDen && !peer?.bannerUrl && peer?.avatarUrl ? (
            <>
              <Image
                source={peer.avatarUrl}
                blurRadius={28}
                contentFit="cover"
                style={{
                  height: 96,
                  transform: [{ scale: 1.75 }],
                  width: "100%",
                }}
              />
              <View
                pointerEvents="none"
                style={{
                  backgroundColor: "rgba(0,0,0,0.4)",
                  inset: 0,
                  position: "absolute",
                }}
              />
            </>
          ) : null}
          {!isDen && peer?.bannerUrl ? (
            <MessageImage
              source={peer.bannerUrl}
              style={{ height: 96, width: "100%" }}
            />
          ) : null}
        </View>
        <View
          style={{
            alignSelf: "flex-start",
            borderColor: theme.cardBg,
            borderRadius: 36,
            borderWidth: 3,
            marginLeft: 12,
            marginTop: -36,
          }}
        >
          {isDen ? (
            <DenAvatar conversation={conversation} size={72} />
          ) : (
            <UserAvatar url={peer?.avatarUrl} userId={peer?.id} size={72} />
          )}
        </View>
        <Text
          style={{
            color: theme.inputText,
            fontFamily: "SofiaProBold",
            fontSize: 20,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProReg",
            fontSize: 14,
          }}
        >
          {isDen
            ? `${activeMembers.length} members`
            : `@${peer?.username ?? ""}`}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: panel.background,
          borderRadius: 16,
          boxShadow: panel.shadows,
          flexDirection: "row",
          gap: 4,
          padding: 4,
        }}
      >
        {(isDen ? ["members", "shared", "details"] : ["details", "shared"]).map(
          (option) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === option }}
              accessibilityLabel={option}
              key={option}
              onPress={() => {
                setTab(option);
                setCursor(undefined);
              }}
              style={{
                alignItems: "center",
                backgroundColor: tab === option ? theme.cardBg : "transparent",
                borderRadius: 12,
                flex: 1,
                justifyContent: "center",
                minHeight: 40,
              }}
            >
              <Text
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProMed",
                  fontSize: 12,
                }}
              >
                {
                  {
                    details: isDen ? "Settings" : "Details",
                    members: "Members",
                    shared: "Media",
                  }[option]
                }
              </Text>
            </Pressable>
          )
        )}
      </View>
      {tab === "details" || tab === "members" ? (
        <>
          <Pressable
            disabled={busy || conversationLeft(conversation, userId)}
            accessibilityLabel={
              prefs.mutedAt ? "Unmute conversation" : "Mute conversation"
            }
            onPress={() => {
              void handleWritePrefs({ muted: !prefs.mutedAt });
            }}
            style={{
              alignItems: "center",
              backgroundColor: panel.background,
              borderRadius: 16,
              boxShadow: panel.shadows,
              flexDirection: "row",
              gap: 12,
              padding: 16,
            }}
          >
            <BellOff size={18} color={theme.dividerText} />
            <Text
              style={{
                color: theme.inputText,
                flex: 1,
                fontFamily: "SofiaProMed",
              }}
            >
              {prefs.mutedAt ? "Unmute" : "Mute"}
            </Text>
            <Host
              style={{ height: 32, width: 52 }}
              colorScheme={isDark ? "dark" : "light"}
            >
              <Switch
                value={Boolean(prefs.mutedAt)}
                disabled={busy || conversationLeft(conversation, userId)}
                onValueChange={(value) => {
                  void handleWritePrefs({ muted: value });
                }}
              />
            </Host>
          </Pressable>
          {isDen && tab === "members" ? (
            <>
              <DenRoster
                conversation={conversation}
                information={den}
                userId={userId}
                onChanged={onRefresh}
              />
              {conversationLeft(conversation, userId) ? (
                <Text style={{ color: theme.dividerText }}>
                  You left this den
                </Text>
              ) : null}
              {conversationLeft(conversation, userId) ? null : (
                <StatusActionButton label="Leave den" onPress={handleLeave} />
              )}
            </>
          ) : null}
          {isDen ? null : (
            <Pressable
              onPress={() => {
                onClose();
                if (peer?.username) {
                  router.push(`/users/${peer.username}`);
                }
              }}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 12,
                padding: 16,
              }}
            >
              <UserRound size={18} color={theme.dividerText} />
              <Text
                style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}
              >
                View profile
              </Text>
            </Pressable>
          )}
        </>
      ) : null}
      {tab === "details" ? (
        <>
          {isDen && den ? (
            <DenSettings
              conversation={conversation}
              information={den}
              onChanged={onRefresh}
              onDissolved={() => {
                onClose();
                router.replace("/messages");
              }}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: themeOpen }}
            onPress={() => setThemeOpen((value) => !value)}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              paddingVertical: 12,
            }}
          >
            <Palette size={18} color={theme.dividerText} />
            <Text
              style={{
                color: theme.inputText,
                flex: 1,
                fontFamily: "SofiaProMed",
              }}
            >
              Chat theme
            </Text>
            <ChevronDown
              size={18}
              color={theme.dividerText}
              style={{ transform: [{ rotate: themeOpen ? "180deg" : "0deg" }] }}
            />
          </Pressable>
          {themeOpen ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {CONVERSATION_THEMES.map((option) => (
                <Pressable
                  disabled={busy || conversationLeft(conversation, userId)}
                  accessibilityLabel={`${option.label} theme`}
                  accessibilityState={{
                    selected: prefs.themeKey === option.key,
                  }}
                  key={option.key}
                  onPress={() => {
                    void handleWritePrefs({ themeKey: option.key });
                  }}
                  style={{ alignItems: "center", gap: 6, width: 88 }}
                >
                  <LinearGradient
                    colors={[option.from, option.to]}
                    style={{
                      borderColor:
                        prefs.themeKey === option.key
                          ? theme.inputText
                          : option.to,
                      borderRadius: 16,
                      borderWidth: 2,
                      height: 44,
                      width: 64,
                    }}
                  />
                  <Text
                    style={{
                      color: theme.inputText,
                      fontFamily: "SofiaProReg",
                      fontSize: 12,
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: wallpaperOpen }}
            onPress={() => setWallpaperOpen((value) => !value)}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              paddingVertical: 12,
            }}
          >
            <Palette size={18} color={theme.dividerText} />
            <Text
              style={{
                color: theme.inputText,
                flex: 1,
                fontFamily: "SofiaProMed",
              }}
            >
              Chat wallpaper
            </Text>
            <ChevronDown
              size={18}
              color={theme.dividerText}
              style={{
                transform: [{ rotate: wallpaperOpen ? "180deg" : "0deg" }],
              }}
            />
          </Pressable>
          {wallpaperOpen ? (
            <>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {[null, "doodle"].map((key) => (
                  <Pressable
                    disabled={
                      busy ||
                      conversationLeft(conversation, userId) ||
                      (isDen && !den?.canManage)
                    }
                    accessibilityLabel={
                      key ? "Doodle wallpaper" : "No wallpaper"
                    }
                    accessibilityState={{
                      selected:
                        !prefs.wallpaperMediaId &&
                        (prefs.wallpaperKey ?? null) === key,
                    }}
                    key={key ?? "none"}
                    onPress={() => {
                      void handleWritePrefs({ wallpaperKey: key });
                    }}
                    style={{ alignItems: "center", gap: 6, width: 100 }}
                  >
                    <View
                      style={{
                        backgroundColor: theme.containerBg,
                        borderColor: theme.dividerLine,
                        borderRadius: 12,
                        borderWidth: 1,
                        height: 70,
                        overflow: "hidden",
                        width: 100,
                      }}
                    >
                      {key ? (
                        <Image
                          source={chatDoodle}
                          style={{ height: 70, width: 100 }}
                        />
                      ) : null}
                    </View>
                    <Text style={{ color: theme.inputText }}>
                      {key ? "Doodle" : "None"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <StatusActionButton
                label="Upload wallpaper"
                onPress={handleUploadWallpaper}
                disabled={
                  busy ||
                  conversationLeft(conversation, userId) ||
                  (isDen && !den?.canManage)
                }
              />
              {prefs.wallpaperMediaId ? (
                <StatusActionButton
                  label="Remove wallpaper"
                  onPress={handleRemoveWallpaper}
                  disabled={
                    busy ||
                    conversationLeft(conversation, userId) ||
                    (isDen && !den?.canManage)
                  }
                />
              ) : null}
              {prefs.wallpaperKey || prefs.wallpaperMediaId ? (
                <>
                  <Text style={{ color: theme.dividerText }}>
                    Dim · {Math.round(dim)}%
                  </Text>
                  <Host
                    style={{ height: 40, width: "100%" }}
                    colorScheme={isDark ? "dark" : "light"}
                  >
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={dim}
                      onValueChange={handleDim}
                      disabled={
                        busy ||
                        conversationLeft(conversation, userId) ||
                        (isDen && !den?.canManage)
                      }
                    />
                  </Host>
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {!isDen && tab === "details" ? (
        <View style={{ flexDirection: "row", gap: 12 }}>
          {["Block", "Report"].map((label) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  label,
                  `${label === "Block" ? "Blocking" : "Reporting"} isn't available yet.`
                )
              }
              style={{
                alignItems: "center",
                backgroundColor: panel.background,
                borderRadius: 16,
                boxShadow: panel.shadows,
                flex: 1,
                padding: 12,
              }}
            >
              <Text style={{ color: "#dc2626", fontFamily: "SofiaProMed" }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {tab === "shared" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["media", "post", "link"] as const).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: kind === option }}
                onPress={() => {
                  setKind(option);
                  setCursor(undefined);
                  setReferences([]);
                }}
                style={{
                  alignItems: "center",
                  backgroundColor:
                    kind === option ? panel.background : "transparent",
                  borderRadius: 12,
                  flex: 1,
                  padding: 10,
                }}
              >
                <Text style={{ color: theme.inputText }}>
                  {{ link: "Links", media: "Media", post: "Posts" }[option]}
                </Text>
              </Pressable>
            ))}
          </View>
          {sharedHint ? (
            <Text style={{ color: theme.dividerText }}>{sharedHint}</Text>
          ) : null}
          <View
            style={{
              flexDirection: kind === "media" ? "row" : "column",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {references.map((reference) => (
              <Pressable
                key={reference.key}
                onPress={() => handleOpenReference(reference)}
                style={{
                  backgroundColor: panel.background,
                  borderRadius: 12,
                  overflow: "hidden",
                  padding: kind === "media" ? 0 : 10,
                  width: kind === "media" ? "31%" : "100%",
                }}
              >
                {reference.postId ? (
                  <MessagePostPreview
                    key={reference.postId}
                    postId={reference.postId}
                  />
                ) : null}
                {kind === "media" && reference.url ? (
                  <MessageImage
                    source={reference.url}
                    style={{ aspectRatio: 1, width: "100%" }}
                  />
                ) : (
                  <Text
                    numberOfLines={2}
                    style={{
                      color: theme.inputText,
                      fontFamily: "SofiaProReg",
                    }}
                  >
                    {reference.label}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
          {shared?.nextCursor ? (
            <StatusActionButton
              label="More shared items"
              onPress={() => setCursor(shared.nextCursor ?? undefined)}
              disabled={loading}
            />
          ) : null}
        </>
      ) : null}
      {denError ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.dividerText }}>
            {denError}
          </Text>
          <StatusActionButton
            label="Retry den details"
            onPress={() => setDenRevision((value) => value + 1)}
          />
        </View>
      ) : null}
      {error ? (
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="alert"
            style={{
              color: isDark ? "#ff8a80" : "#dc2626",
              fontFamily: "SofiaProReg",
            }}
          >
            {error}
          </Text>
          {tab === "shared" ? (
            <StatusActionButton
              label="Retry shared items"
              onPress={() => setSharedRevision((value) => value + 1)}
            />
          ) : null}
        </View>
      ) : null}
    </MessageSheet>
  );
}
