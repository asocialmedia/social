import { externalAuthorSchema } from "@asm/protocols/discovery";
import { Host, BottomSheet, Column } from "@expo/ui";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { create } from "zustand";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { BioContent } from "@/features/home/components/bio-content";
import { networkRequest } from "@/features/network/lib/network-api";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { cachedExternalAuthor } from "../lib/external-cache";
import { useExternalFollow } from "../state/use-external-follow";

export const useExternalAuthorPreview = create<{
  actor: string | null;
  open: (actor: string) => void;
  close: () => void;
}>((set) => ({
  actor: null,
  close: () => set({ actor: null }),
  open: (actor) => set({ actor }),
}));
export function ExternalAuthorPreview() {
  const actor = useExternalAuthorPreview((state) => state.actor);
  return actor ? (
    <ExternalAuthorPreviewContent key={actor} actor={actor} />
  ) : null;
}
function ExternalAuthorPreviewContent({ actor }: { actor: string }) {
  const close = useExternalAuthorPreview((state) => state.close);
  const router = useRouter();
  const { theme } = useAppTheme();
  const query = useProtocolResource(
    `bluesky-profile:${actor}`,
    async (signal) =>
      externalAuthorSchema.parse(
        await networkRequest(
          `/api/protocols/bluesky/profile?${new URLSearchParams({ actor })}`,
          { signal }
        )
      )
  );
  const author = query.data ?? cachedExternalAuthor(actor);
  const follow = useExternalFollow(author?.id ?? actor, Boolean(author));
  return (
    <Host>
      <BottomSheet isPresented onDismiss={close} snapPoints={["half", "full"]}>
        <Column>
          <View className="gap-3 p-5">
            {author ? (
              <>
                <UserAvatar size={64} url={author.avatarUrl} seed={author.id} />
                <Text
                  selectable
                  className="text-lg font-semibold"
                  style={{ color: theme.inputText }}
                >
                  {author.displayName} · Bluesky
                </Text>
                <Text selectable style={{ color: theme.dividerText }}>
                  @{author.handle}
                </Text>
                {author.description ? (
                  <BioContent
                    apiBase={getApiBaseUrl()}
                    bio={author.description}
                  />
                ) : null}
                <SettingsButton
                  label={
                    follow.following ? "Following in ASM" : "Follow in ASM"
                  }
                  disabled={follow.pending}
                  onPress={() => {
                    void follow.toggle();
                  }}
                />
              </>
            ) : (
              <Text style={{ color: theme.dividerText }}>
                {query.loading ? "Loading profile…" : query.error}
              </Text>
            )}
            {query.error ? (
              <SettingsButton
                label="Retry profile"
                tone="gray"
                onPress={() => {
                  void query.refetch();
                }}
              />
            ) : null}
            <SettingsButton
              label="View full profile"
              tone="gray"
              onPress={() => {
                close();
                router.push({
                  params: { actor },
                  pathname: "/external-profile",
                });
              }}
            />
          </View>
        </Column>
      </BottomSheet>
    </Host>
  );
}
