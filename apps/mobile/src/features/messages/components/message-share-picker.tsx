import { useRouter } from "expo-router";
// Shares a post into messages, ported from
// apps/web/src/components/messages/message-share-picker.tsx. Same flow: an
// identity gate (conversation skeleton, lock screen with an Open Messages entry),
// a follow-only people search, recent conversation peers when idle, an
// optional caption, and a direct encrypted send per row with its own busy
// state. The 409 ratchet retry lives in `sendEncryptedMessage` itself; the
// pipeline here only prepares keys and the sender's index.
import {
  History,
  Lock,
  MessageSquareQuote,
  Search,
  Send,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  createConversation,
  ensureConversationKeys,
  fetchConversationDetail,
  fetchConversationList,
  postConversationKeys,
  sendEncryptedMessage,
} from "@/features/messages/lib/client";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { useProfileSearch } from "@/features/messages/state/use-profile-search";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { ConversationListSkeleton } from "./messages-skeleton";

interface ShareRecipient {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  username: string;
}

// The send pipeline: open (or create) a DM, wrap keys for both members, read
// the sender's ratchet index, and post the encrypted post card. Module scope
// because the compiler cannot lower promise chains with cleanup inside a
// component; it rejects on any failure and the caller surfaces the message.
async function sharePostToConversation(input: {
  caption: string;
  options: ApiCallOptions;
  postId: string;
  privateKey: Parameters<typeof ensureConversationKeys>[1];
  recipientId: string;
  senderId: string;
}): Promise<string> {
  const { conversation } = await createConversation(
    input.recipientId,
    input.options
  );
  const rootKey = await ensureConversationKeys(
    conversation,
    input.privateKey,
    input.senderId,
    {
      postKeys: (target, keys) =>
        postConversationKeys(target, keys, input.options),
      refreshConversation: async () => {
        const fresh = await fetchConversationDetail(
          conversation.id,
          input.options
        );
        return fresh.conversation;
      },
    }
  );
  if (!rootKey) {
    throw new Error("Couldn't prepare conversation keys");
  }
  const detail = await fetchConversationDetail(conversation.id, input.options);
  const trimmed = input.caption.trim();
  await sendEncryptedMessage(
    conversation.id,
    rootKey,
    input.senderId,
    detail.mySentCount,
    {
      ...(trimmed ? { content: trimmed } : {}),
      postId: input.postId,
      type: "post",
    },
    input.options
  );
  return conversation.id;
}

export function MessageSharePicker({
  postId,
  onShare,
  onSent,
}: {
  // Sharing a post card. Omit for the forward flow, where the caller sends
  // through `onShare` instead (the options sheet's Forward row).
  postId?: string;
  onShare?: (conversationId: string, caption: string) => Promise<void>;
  onSent?: (conversationId: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const { privateKey, status } = useMessagesIdentity();
  const [query, setQuery] = useState("");
  const [caption, setCaption] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [recents, setRecents] = useState<ShareRecipient[]>([]);
  const search = useProfileSearch(status === "ready" ? query : "");
  const field = premiumInput(isDark, false);

  useEffect(() => {
    if (!user) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        const list = await fetchConversationList(options);
        if (!active) {
          return;
        }
        // People you already chat with, so sharing again needs no search.
        // First DM peer per conversation, capped at five like web.
        const peers: ShareRecipient[] = [];
        for (const item of list.items) {
          const peer = item.conversation.members.find(
            (member) => member.userId !== user.id
          )?.user;
          if (peer) {
            peers.push({
              avatarUrl: peer.avatarUrl,
              displayName: peer.displayName,
              id: peer.id,
              username: peer.username,
            });
          }
          if (peers.length >= 5) {
            break;
          }
        }
        setRecents(peers);
      } catch {
        if (active) {
          setRecents([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ConversationListSkeleton rows={4} label="Opening share" />
      </View>
    );
  }

  if (status !== "ready" || !privateKey) {
    return (
      <View style={styles.center}>
        <Lock color={theme.dividerText} size={24} />
        <Text style={[styles.lockCopy, { color: theme.dividerText }]}>
          Messages are encrypted, and the setup happens on your device. Open
          Messages once to get started.
        </Text>
        <Pressable
          accessibilityLabel="Open Messages"
          accessibilityRole="button"
          onPress={() => router.push("/messages")}
          style={styles.openButton}
        >
          <Text style={styles.openLabel}>Open Messages</Text>
        </Pressable>
      </View>
    );
  }

  const handleShare = (recipient: ShareRecipient) => {
    if (!user || sendingTo) {
      return;
    }
    setSendingTo(recipient.id);
    void (async () => {
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        // The forward flow sends through the caller (the options sheet owns
        // the decrypted payload); a post card sends directly like web.
        if (onShare) {
          await onShare(recipient.id, caption);
        } else if (postId) {
          const conversationId = await sharePostToConversation({
            caption,
            options,
            postId,
            privateKey,
            recipientId: recipient.id,
            senderId: user.id,
          });
          onSent?.(conversationId);
        } else {
          setSendingTo(null);
          return;
        }
        toast({
          description: `Sent to ${recipient.displayName}`,
          title: "Message sent",
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't send message",
          title: "Can't share",
          variant: "destructive",
        });
      }
      setSendingTo(null);
    })();
  };

  const searching = query.trim().length > 0;
  const inputStyle = {
    backgroundColor: field.background,
    boxShadow: field.shadows,
  };

  function renderResults() {
    if (searching) {
      if (search.loading) {
        return <ConversationListSkeleton rows={4} label="Searching people" />;
      }
      if (search.profiles.length === 0) {
        return (
          <Text style={[styles.hint, { color: theme.dividerText }]}>
            No one found. You can only message people you follow.
          </Text>
        );
      }
      return search.profiles.map((result) => (
        <RecipientRow
          key={result.id}
          onSelect={() =>
            handleShare({
              avatarUrl: result.avatarUrl,
              displayName: result.displayName,
              id: result.id,
              username: result.username,
            })
          }
          recipient={{
            avatarUrl: result.avatarUrl,
            displayName: result.displayName,
            id: result.id,
            username: result.username,
          }}
          sending={sendingTo === result.id}
        />
      ));
    }
    if (recents.length === 0) {
      return (
        <View style={styles.empty}>
          <History color={theme.dividerText} size={24} />
          <Text style={[styles.hint, { color: theme.dividerText }]}>
            No conversations yet. Search for someone you follow to send your
            first message.
          </Text>
        </View>
      );
    }
    return (
      <>
        <Text style={[styles.section, { color: theme.dividerText }]}>
          Recent
        </Text>
        {recents.map((recipient) => (
          <RecipientRow
            key={recipient.id}
            onSelect={() => handleShare(recipient)}
            recipient={recipient}
            sending={sendingTo === recipient.id}
          />
        ))}
      </>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.input, inputStyle]}>
        <Search color={field.placeholder} size={16} />
        <TextInput
          accessibilityLabel="Search people you follow"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search people you follow…"
          placeholderTextColor={field.placeholder}
          style={[styles.inputText, { color: field.text }]}
          value={query}
        />
      </View>
      <View style={[styles.input, inputStyle]}>
        <MessageSquareQuote color={field.placeholder} size={16} />
        <TextInput
          accessibilityLabel="Add a caption, optional"
          maxLength={500}
          onChangeText={setCaption}
          placeholder="Add a caption (optional)…"
          placeholderTextColor={field.placeholder}
          style={[styles.inputText, { color: field.text }]}
          value={caption}
        />
      </View>
      {renderResults()}
    </View>
  );
}

function RecipientRow({
  onSelect,
  recipient,
  sending,
}: {
  onSelect: () => void;
  recipient: ShareRecipient;
  sending: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`Send to ${recipient.displayName}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: sending }}
      disabled={sending}
      onPress={onSelect}
      style={styles.row}
    >
      <UserAvatar size={34} url={recipient.avatarUrl} userId={recipient.id} />
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[styles.rowName, { color: theme.inputText }]}
        >
          {recipient.displayName}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.rowSub, { color: theme.dividerText }]}
        >
          @{recipient.username}
        </Text>
      </View>
      {sending ? (
        <ZephLoader variant="messages" accessibilityLabel="Sending message" />
      ) : (
        <Send color={theme.dividerText} size={16} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
  },
  empty: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 24,
  },
  hint: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  input: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  inputText: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minWidth: 0,
  },
  lockCopy: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxWidth: 224,
    textAlign: "center",
  },
  openButton: {
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    minHeight: 32,
    paddingHorizontal: 16,
  },
  openLabel: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  root: {
    gap: 10,
  },
  row: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  rowName: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  rowSub: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    fontFamily: "SofiaProMed",
    fontSize: 10,
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
});
