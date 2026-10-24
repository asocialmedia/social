import { externalAuthorSchema } from "@asm/protocols/discovery";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Link, Network } from "lucide-react-native";
import { useState } from "react";
import { Alert, Text } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { useAppTheme } from "@/theme";

import { blueskyConnectionSchema } from "../lib/bluesky-connection";
import { authorizeNativeBluesky } from "../lib/bluesky-native-auth";
import { networkRequest } from "../lib/network-api";
import {
  invalidateProtocolResources,
  useProtocolResource,
} from "../state/use-protocol-resource";

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
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const connect = async () => {
    if (pending || !handle.trim()) {
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      const savedHandle = await authorizeNativeBluesky(handle, {
        digest: (verifier) =>
          Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            verifier
          ),
        openBrowser: WebBrowser.openAuthSessionAsync,
        randomId: Crypto.randomUUID,
        request: networkRequest,
      });
      if (savedHandle === null) {
        setPending(false);
        return;
      }
      setHandle(savedHandle);
      invalidateProtocolResources("bluesky-");
      await refresh();
      onChanged();
      await connection.refetch();
      router.setParams({ bluesky: "connected", code: "", state: "" });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Couldn't connect Bluesky"
      );
    }
    setPending(false);
  };
  const disconnect = async () => {
    setPending(true);
    setErrorMessage(null);
    try {
      await networkRequest("/api/protocols/bluesky/unlink", { method: "POST" });
      invalidateProtocolResources("bluesky-");
      await refresh();
      onChanged();
      await connection.refetch();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Couldn't disconnect Bluesky"
      );
    }
    setPending(false);
  };
  const connected = connection.data?.connected;
  let status = connection.loading ? "Checking connection…" : "Unlinked";
  if (connected) {
    status =
      connection.data?.canLike && connection.data?.canReply
        ? "Active"
        : "Reconnect needed";
  }
  return (
    <SectionAnchor id="settings-bluesky-connection" tab="account">
      <SettingsCard>
        <SettingsCardHeading
          title="Bluesky connection"
          icon={Network}
          description="Authorize securely with your account provider. Your password stays there."
        />
        <Text selectable style={{ color: theme.inputText }}>
          {linkedAuthor.data?.handle ? `@${linkedAuthor.data.handle} · ` : ""}
          {status}
          {connection.data?.did ? ` · ${connection.data.did}` : ""}
        </Text>
        {emailVerified ? null : (
          <Text style={{ color: theme.dividerText }}>
            Verify your ASM email before connecting an external account.
          </Text>
        )}
        {errorMessage || connection.error ? (
          <Text selectable style={{ color: theme.dividerText }}>
            {errorMessage ?? connection.error}
          </Text>
        ) : null}
        {params.bluesky === "connected" ? (
          <Text style={{ color: theme.inputText }}>Bluesky connected.</Text>
        ) : null}
        <SettingsInput
          label="Bluesky handle"
          placeholder="alice.bsky.social"
          value={handle}
          onChangeText={setHandle}
          maxLength={253}
        />
        <SettingsButton
          label={connected ? "Reconnect securely" : "Connect Bluesky"}
          leadingIcon={Link}
          loading={pending}
          disabled={!emailVerified || !user || !handle.trim()}
          onPress={() => {
            void connect();
          }}
        />
        {connected ? (
          <SettingsButton
            label="Disconnect Bluesky"
            tone="danger"
            disabled={pending}
            onPress={() =>
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
              )
            }
          />
        ) : null}
        <SettingsButton
          tone="gray"
          label="Manage Bluesky follows in ASM"
          onPress={() => router.push("/external-following")}
        />
        {connection.error ? (
          <SettingsButton
            tone="gray"
            label="Retry connection status"
            onPress={() => {
              void connection.refetch();
            }}
          />
        ) : null}
      </SettingsCard>
    </SectionAnchor>
  );
}
