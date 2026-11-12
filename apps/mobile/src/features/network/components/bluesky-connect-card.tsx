import { externalAuthorSchema } from "@asm/protocols/discovery";
// Native port of web's `settings/bluesky-connect-card.tsx`: the blue Bluesky
// card (icon tile, title, "Linked" chip, status pill, unverified-email notice,
// then either the linked handle with its actions or the connect pitch), the
// connect dialog that asks for a handle, and the followed-accounts card web
// renders right under it. Native keeps its own OAuth hand-off
// (`authorizeNativeBluesky`) because the app cannot follow web's redirect.
import { FontAwesome6 } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  Check,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Unlink,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { useSessionContext } from "@/features/auth/state/session";
import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { haptic } from "@/lib/interaction/haptics";
import { openExternalUrl } from "@/lib/interaction/open-url";
import { useAppTheme } from "@/theme";

import { blueskyConnectionSchema } from "../lib/bluesky-connection";
import { authorizeNativeBluesky } from "../lib/bluesky-native-auth";
import { networkRequest } from "../lib/network-api";
import {
  invalidateProtocolResources,
  useProtocolResource,
} from "../state/use-protocol-resource";
import { ExternalFollowingCard } from "./external-following-card";

const BLUESKY_BLUE = "#0866df";

// Web: `bg-linear-to-b from-[#159dff] via-[#0980fa] to-[#0866df]` with a 2px
// white edge and the inset lip plus the blue drop shadow.
const CARD_GRADIENT = ["#159dff", "#0980fa", "#0866df"] as const;
const CARD_SHADOWS =
  "0 0 0 2px rgba(255,255,255,0.8), inset 0 0 0 1.5px rgba(255,255,255,0.45), inset 0 2px 4px rgba(255,255,255,0.55), 0 4px 20px -2px rgba(8,102,223,0.35)";

// `.btn-3d-white` from packages/ui/styles/globals.css.
const WHITE_BUTTON = {
  colors: ["#ffffff", "#eaf2fd"] as const,
  pressedColors: ["#e2edfd", "#d5e5fc"] as const,
  pressedShadows:
    "inset 0 0 0 1px rgba(255,255,255,0.7), inset 0 1px 2px rgba(0,0,0,0.1), 0 0 0 1px rgba(7,88,191,0.25), 0 1px 2px rgba(0,0,0,0.08)",
  shadows:
    "inset 0 0 0 1px rgba(255,255,255,0.95), inset 0 1.5px 2px #ffffff, 0 0 0 1px rgba(7,88,191,0.25), 0 1px 2px rgba(0,0,0,0.12), 0 3px 8px rgba(0,50,150,0.22)",
  text: BLUESKY_BLUE,
};

// `.btn-3d-bluesky`.
const BLUE_BUTTON = {
  colors: ["#159dff", "#0866df"] as const,
  pressedColors: ["#0b8cf0", "#0758bf"] as const,
  pressedShadows:
    "inset 0 0 0 1px rgb(255 255 255 / 20%), inset 0 1px 2px rgba(0,0,0,0.15), 0 0 0 1px #0758bf",
  shadows:
    "inset 0 0 0 1px rgb(255 255 255 / 28%), inset 0 1.5px 2px rgb(255 255 255 / 50%), 0 0 0 1px #0758bf, 0 1px 1px rgb(255 255 255 / 45%), 0 4px 10px -3px rgb(0 70 180 / 35%)",
  text: "#ffffff",
};

// `.btn-3d-danger`, the light recipe: the card is always blue, so the button
// keeps its light face in both themes, like web.
const DANGER_BUTTON = {
  colors: ["#ffe3e3", "#ffcaca"] as const,
  pressedColors: ["#ffd5d5", "#ffb3b3"] as const,
  pressedShadows:
    "inset 0 1px 2px rgba(0,0,0,0.12), 0 0 0 1px rgba(185,28,28,0.3)",
  shadows:
    "inset 0 0 0 1px rgba(255,255,255,0.7), inset 0 1.5px 2px rgba(255,255,255,0.9), 0 0 0 1px rgba(185,28,28,0.28), 0 1px 2px rgba(0,0,0,0.1)",
  text: "#b91c1c",
};

// shadcn's `secondary` Button: a flat light gray face with dark text.
const SECONDARY_BUTTON = {
  colors: ["#f4f4f5", "#f4f4f5"] as const,
  pressedColors: ["#e4e4e7", "#e4e4e7"] as const,
  pressedShadows: "0 0 0 0 transparent",
  shadows: "0 1px 2px rgba(0,0,0,0.05)",
  text: "#18181b",
};

function CardButton({
  disabled,
  height = 36,
  icon,
  label,
  loading,
  onPress,
  paddingHorizontal = 16,
  radius = 12,
  recipe,
  textSize = 12,
}: {
  disabled?: boolean;
  height?: number;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  onPress: () => void;
  paddingHorizontal?: number;
  radius?: number;
  recipe: {
    colors: readonly [string, string, ...string[]];
    pressedColors: readonly [string, string, ...string[]];
    pressedShadows: string;
    shadows: string;
    text: string;
  };
  textSize?: number;
}) {
  const gated = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: gated }}
      disabled={gated}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={gated ? styles.gated : null}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={pressed && !gated ? recipe.pressedColors : recipe.colors}
          radius={radius}
          shadows={pressed && !gated ? recipe.pressedShadows : recipe.shadows}
          style={[
            styles.cardButton,
            { height, paddingHorizontal },
            pressed && !gated ? styles.pressed : null,
          ]}
        >
          {loading ? (
            <ZephLoader color={recipe.text} size="small" variant="general" />
          ) : (
            icon
          )}
          <Text
            style={[
              styles.cardButtonText,
              { color: recipe.text, fontSize: textSize },
            ]}
          >
            {label}
          </Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

export function BlueskyConnectCard({
  emailVerified,
  onChanged,
}: {
  emailVerified: boolean;
  onChanged: () => void;
}) {
  const { user, refresh } = useSessionContext();
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ bluesky?: string }>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connection = useProtocolResource(
    `bluesky-connection:${user?.id ?? "guest"}`,
    async (signal) =>
      blueskyConnectionSchema.parse(
        await networkRequest("/api/protocols/bluesky/likes", { signal })
      ),
    Boolean(user)
  );
  const linkedAuthor = useProtocolResource(
    `bluesky-linked-author:${user?.id}:${connection.data?.did}`,
    async (signal) =>
      externalAuthorSchema.parse(
        await networkRequest(
          `/api/protocols/bluesky/profile?${new URLSearchParams({ actor: connection.data?.did ?? "" })}`,
          { signal }
        )
      ),
    Boolean(connection.data?.did)
  );

  // Web reads `?bluesky=` once, toasts the outcome and strips the param.
  const blueskyResult = params.bluesky;
  useEffect(() => {
    if (!blueskyResult) {
      return;
    }
    const connectedResult = blueskyResult === "connected";
    toast({
      description: connectedResult
        ? "Your account is authorized securely."
        : "Authorization was cancelled or expired. Please try again.",
      title: connectedResult
        ? "Bluesky connected"
        : "Bluesky connection failed",
      variant: connectedResult ? undefined : "destructive",
    });
    router.setParams({ bluesky: "", code: "", state: "" });
  }, [blueskyResult, router]);

  const isConnected = connection.data?.connected === true;
  const cleanHandle = (linkedAuthor.data?.handle ?? "").replace(/^@/, "");
  let connectionStatus =
    connection.loading && !connection.data ? "Checking…" : "Unlinked";
  if (isConnected) {
    connectionStatus =
      connection.data?.canLike && connection.data?.canReply
        ? "Active"
        : "Reconnect needed";
  }

  const openDialog = () => {
    setHandle(cleanHandle);
    setDialogOpen(true);
  };

  const connect = async () => {
    if (connecting) {
      return;
    }
    if (!handle.trim()) {
      toast({
        description: "Please enter your Bluesky handle.",
        title: "Missing Handle",
        variant: "destructive",
      });
      return;
    }
    setConnecting(true);
    try {
      const savedHandle = await authorizeNativeBluesky(handle.trim(), {
        digest: (verifier) =>
          Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            verifier
          ),
        openBrowser: WebBrowser.openAuthSessionAsync,
        randomId: Crypto.randomUUID,
        request: networkRequest,
      });
      if (savedHandle !== null) {
        setDialogOpen(false);
        invalidateProtocolResources("bluesky-");
        await refresh();
        onChanged();
        await connection.refetch();
        router.setParams({ bluesky: "connected", code: "", state: "" });
      }
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Could not link your Bluesky account.",
        title: "Connection Failed",
        variant: "destructive",
      });
    }
    setConnecting(false);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await networkRequest("/api/protocols/bluesky/unlink", { method: "POST" });
      invalidateProtocolResources("bluesky-");
      await refresh();
      onChanged();
      await connection.refetch();
      toast({
        description: "Your Bluesky account is no longer linked.",
        title: "Bluesky disconnected",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't disconnect Bluesky",
        title: "Disconnect Failed",
        variant: "destructive",
      });
    }
    setDisconnecting(false);
  };

  const confirmDisconnect = () =>
    Alert.alert(
      "Disconnect Bluesky?",
      "Your ASM follows and discussion stay.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void disconnect();
          },
          style: "destructive",
          text: "Disconnect",
        },
      ]
    );

  return (
    <>
      <SectionAnchor id="settings-bluesky-connection" tab="account">
        <Gradient3D
          colors={CARD_GRADIENT}
          radius={16}
          shadows={CARD_SHADOWS}
          style={styles.card}
        >
          {/* Header row: tile, title + chip + copy, status pill. */}
          <View style={styles.headerRow}>
            <View style={styles.headerLead}>
              <View style={styles.iconTile}>
                <FontAwesome6 color="#ffffff" name="bluesky" size={22} />
              </View>
              <View style={styles.headerCopy}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>Bluesky Connection</Text>
                  {isConnected ? (
                    <View style={styles.linkedChip}>
                      <Sparkles color="#ffffff" size={12} />
                      <Text style={styles.linkedChipText}>Linked</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.subtitle}>
                  Connect your AT Protocol account to interact across federated
                  threads and post seamlessly.
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.statusPill,
                isConnected ? styles.statusPillOn : styles.statusPillOff,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: isConnected ? "#ffffff" : "rgba(255,255,255,0.8)" },
                ]}
              >
                {connectionStatus}
              </Text>
            </View>
          </View>

          {emailVerified ? null : (
            <View style={styles.notice}>
              <ShieldAlert color="#fcd34d" size={16} />
              <Text style={styles.noticeText}>
                You must verify your email address on asocialmedia before
                connecting an external federated account.
              </Text>
            </View>
          )}

          {connection.error && !connection.data ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{connection.error}</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => {
                  void connection.refetch();
                }}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {isConnected ? (
            <View style={styles.footer}>
              <View>
                <Text style={styles.linkedAccountLabel}>
                  LINKED BLUESKY HANDLE
                </Text>
                <Text selectable style={styles.linkedAccountValue}>
                  @{cleanHandle || connection.data?.did}
                </Text>
              </View>
              <View style={styles.actions}>
                <CardButton
                  disabled={!emailVerified || !user}
                  height={36}
                  label="Reconnect securely"
                  onPress={openDialog}
                  radius={6}
                  recipe={SECONDARY_BUTTON}
                  textSize={14}
                />
                {cleanHandle ? (
                  <CardButton
                    icon={<ExternalLink color={BLUESKY_BLUE} size={14} />}
                    label="View Profile"
                    onPress={() => {
                      void openExternalUrl(
                        `https://bsky.app/profile/${cleanHandle}`
                      );
                    }}
                    recipe={WHITE_BUTTON}
                  />
                ) : null}
                <CardButton
                  icon={<Unlink color={DANGER_BUTTON.text} size={14} />}
                  label="Disconnect"
                  loading={disconnecting}
                  onPress={confirmDisconnect}
                  recipe={DANGER_BUTTON}
                />
              </View>
            </View>
          ) : (
            <View style={styles.footer}>
              <Text style={styles.pitch}>
                Linking your account allows you to cross-post, reply to Bluesky
                discussions, and broadcast your interactions directly to the AT
                Protocol firehose.
              </Text>
              <CardButton
                disabled={!emailVerified || !user}
                height={40}
                icon={
                  <FontAwesome6 color={BLUESKY_BLUE} name="bluesky" size={16} />
                }
                label="Connect Bluesky"
                onPress={openDialog}
                paddingHorizontal={24}
                recipe={WHITE_BUTTON}
                textSize={14}
              />
            </View>
          )}
        </Gradient3D>
      </SectionAnchor>

      <ExternalFollowingCard />

      {dialogOpen ? (
        <DialogPanel
          busy={connecting}
          description="Enter your Bluesky handle. You'll continue to your account provider to review permissions and authorize asocialmedia."
          onClose={() => setDialogOpen(false)}
          title="Connect your Bluesky Account"
        >
          <View style={styles.dialogBody}>
            <SettingsInput
              label="Bluesky Handle"
              leadingText="@"
              maxLength={253}
              onChangeText={setHandle}
              placeholder="alice.bsky.social"
              value={handle}
            />
            <Text style={[styles.dialogHint, { color: theme.dividerText }]}>
              Your handle on Bluesky or your custom domain handle.
            </Text>
            <Text style={[styles.dialogCopy, { color: theme.dividerText }]}>
              Your password stays with your provider. You can revoke access from
              your Bluesky account settings at any time.
            </Text>
            <View style={styles.dialogActions}>
              <SettingsButton
                disabled={connecting}
                label="Cancel"
                onPress={() => setDialogOpen(false)}
                radius={12}
                size="sm"
                tone="gray"
              />
              <CardButton
                disabled={!handle.trim()}
                height={36}
                icon={<Check color="#ffffff" size={16} />}
                label="Continue to Bluesky"
                loading={connecting}
                onPress={() => {
                  void connect();
                }}
                paddingHorizontal={20}
                recipe={BLUE_BUTTON}
                textSize={14}
              />
            </View>
          </View>
        </DialogPanel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { gap: 20, padding: 20 },
  cardButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  cardButtonText: { fontFamily: "SofiaProBold" },
  dialogActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 8,
  },
  dialogBody: { gap: 12 },
  dialogCopy: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 18 },
  dialogHint: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: -6 },
  footer: {
    borderTopColor: "rgba(255,255,255,0.2)",
    borderTopWidth: 1,
    gap: 16,
    paddingTop: 16,
  },
  gated: { opacity: 0.5 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerLead: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 14,
    minWidth: 0,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  iconTile: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderColor: "rgba(255,255,255,0.5)",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.6)",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  linkedAccountLabel: {
    color: "rgba(255,255,255,0.75)",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    letterSpacing: 0.6,
  },
  linkedAccountValue: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 16,
    fontWeight: "700",
  },
  linkedChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  linkedChipText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  notice: {
    alignItems: "flex-start",
    backgroundColor: "rgba(0,0,0,0.15)",
    borderColor: "rgba(255,255,255,0.3)",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  noticeText: {
    color: "rgba(255,255,255,0.95)",
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 17,
  },
  pitch: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 19,
  },
  pressed: { transform: [{ translateY: 1 }] },
  retryText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 12 },
  statusPill: {
    borderRadius: 9999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillOff: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.3)",
  },
  statusPillOn: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderColor: "rgba(255,255,255,0.6)",
    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4)",
  },
  statusText: { fontFamily: "SofiaProBold", fontSize: 12 },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  title: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 16 },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
