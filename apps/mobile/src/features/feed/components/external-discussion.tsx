// The asocialmedia discussion on a Bluesky post: composer, eddie tree,
// "Load more eddies", and the own-eddie delete flow. Native twin of web's
// protocols/external-discussion.tsx, used by the external post page and the
// gust eddies sheet. Data lives with the caller, because the page loads the
// post and its comments in one request, while the sheet only needs comments.
// Bluesky comments are flat, so Reply focuses the top composer.
import type { ExternalPost } from "@asm/protocols/contracts";
import type { ExternalComment } from "@asm/protocols/discovery";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { TextInputInstance } from "react-native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import noCommentsImage from "@/assets/images/nocomments.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { reelsInput } from "@/components/media/gif-picker";
import { premiumInput, themeText } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { DeleteEddieDialog } from "@/features/eddies/components/delete-eddie-dialog";
import {
  DELETE_ENTRY,
  EddieRow,
  eddieThreadStyles,
} from "@/features/eddies/components/eddie-thread";
import type { RowHandlers } from "@/features/eddies/components/eddie-thread";
import { buildEddieTree } from "@/features/eddies/lib/eddie-tree";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { externalCommentsToFeed } from "../lib/external-comments";
import { useExternalInteractions } from "../state/use-external-interactions";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";

const noop = () => {
  // Row layout offsets only matter for deep scroll, which this thread lacks.
};

export interface ExternalDiscussionProps {
  asm: ExternalPost["asm"] | undefined;
  comments: readonly ExternalComment[];
  hasMore: boolean;
  // The page scrolls the composer into view before focusing it.
  inputRef?: RefObject<TextInputInstance | null>;
  loadingMore: boolean;
  onChanged: () => Promise<void>;
  onLoadMore: () => void;
  onReply?: () => void;
  onRetry?: () => void;
  status?: "error" | "loading" | "ready";
  uri: string;
  // "reels" is the gust drawer: the reels-input field and no top border.
  variant?: "page" | "reels";
}

export function ExternalDiscussion({
  asm,
  comments,
  hasMore,
  inputRef,
  loadingMore,
  onChanged,
  onLoadMore,
  onReply,
  onRetry,
  status = "ready",
  uri,
  variant = "page",
}: ExternalDiscussionProps) {
  const { user } = useSessionContext();
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const textStyle = themeText(isDark);
  const [focused, setFocused] = useState(false);
  const input = premiumInput(isDark, focused);
  const reelsField = reelsInput(isDark);
  const isReels = variant === "reels";
  const localInputRef = useRef<TextInputInstance>(null);
  const composerRef = inputRef ?? localInputRef;
  const [content, setContent] = useState("");
  const requestId = useRef(randomUUID());
  const interaction = useExternalInteractions({ asm, id: uri });
  const [menu, setMenu] = useState<{
    anchor: MenuAnchor;
    commentId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const tree = buildEddieTree(externalCommentsToFeed(comments));

  const submit = async () => {
    if (
      await interaction.mutate({
        action: "comment",
        content,
        requestId: requestId.current,
        uri,
      })
    ) {
      setContent("");
      requestId.current = randomUUID();
      await onChanged();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      if (
        await interaction.mutate({
          action: "delete_comment",
          commentId: deleteTarget,
          uri,
        })
      ) {
        setDeleteTarget(null);
        await onChanged();
      }
    } catch {
      // Best-effort
    }
    setDeleting(false);
  };

  const handlers: RowHandlers = {
    onDelete: (commentId) => setDeleteTarget(commentId),
    onLayoutRow: noop,
    onMore: (commentId, anchor) => setMenu({ anchor, commentId }),
    onOpenAuthor: (username) => {
      if (username.startsWith("did:") || username.includes(".")) {
        router.push({
          params: { actor: username },
          pathname: "/external-profile",
        });
      } else {
        router.push(`/users/${username}` as "/");
      }
    },
    onReply: () => {
      onReply?.();
      composerRef.current?.focus();
    },
    onRequireLogin: () => {
      router.push("/(auth)/login");
    },
  };

  const fieldSurface = isReels
    ? {
        backgroundColor: reelsField.background,
        borderColor: reelsField.border,
        borderWidth: 1,
        boxShadow: focused
          ? `${reelsField.shadows}, 0 0 0 3px rgba(255, 149, 0, 0.18)`
          : reelsField.shadows,
      }
    : { backgroundColor: input.background, boxShadow: input.shadows };

  return (
    <View
      style={[
        eddieThreadStyles.section,
        { borderTopColor: theme.cardBorder, marginTop: isReels ? 0 : 16 },
        isReels && eddieThreadStyles.sectionReels,
      ]}
    >
      {user ? (
        <View style={[styles.composer, isReels && styles.composerReels]}>
          <TextInput
            accessibilityLabel="Write an eddy"
            maxLength={1500}
            multiline
            onBlur={() => setFocused(false)}
            onChangeText={(text) => {
              setContent(text);
              requestId.current = randomUUID();
            }}
            onFocus={() => setFocused(true)}
            placeholder="Write an eddy…"
            placeholderTextColor={theme.dividerText}
            ref={composerRef}
            style={[
              styles.field,
              fieldSurface,
              { color: textStyle.foreground },
            ]}
            value={content}
          />
          <View style={styles.submit}>
            <StatusActionButton
              disabled={interaction.pending || !content.trim()}
              label={interaction.pending ? "Posting…" : "Post eddy"}
              onPress={() => {
                void submit();
              }}
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/login")}
          style={[styles.composer, isReels && styles.composerReels]}
        >
          <Text style={[styles.signIn, { color: theme.inputText }]}>
            Sign in to join the discussion
          </Text>
        </Pressable>
      )}

      {status === "loading" ? (
        <View style={eddieThreadStyles.stateWrap}>
          <ActivityIndicator color={theme.dividerText} />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={eddieThreadStyles.stateWrap}>
          <Image
            contentFit="contain"
            source={noMediaImage}
            style={eddieThreadStyles.errorArt}
          />
          <Text
            style={[eddieThreadStyles.stateText, { color: theme.dividerText }]}
          >
            Couldn't load discussion.
          </Text>
          {onRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry}>
              <Text
                style={[
                  eddieThreadStyles.retryText,
                  { color: theme.dividerText },
                ]}
              >
                Try again
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {status === "ready" && tree.length === 0 ? (
        <View style={eddieThreadStyles.stateWrap}>
          <Image
            contentFit="contain"
            source={noCommentsImage}
            style={eddieThreadStyles.emptyArt}
          />
          <Text
            style={[eddieThreadStyles.stateText, { color: theme.dividerText }]}
          >
            No eddie yet.
          </Text>
        </View>
      ) : null}

      <View style={eddieThreadStyles.listWrap}>
        {tree.map((node, index) => (
          <View
            key={node.comment.id}
            style={[
              index > 0 && eddieThreadStyles.divider,
              index > 0 && { borderTopColor: theme.cardBorder },
            ]}
          >
            <EddieRow
              apiBase={apiBase}
              handlers={handlers}
              inlineReplyFor={null}
              isLast={false}
              node={node}
              onCloseInlineReply={noop}
              postId={uri}
              viewerId={user?.id}
            />
          </View>
        ))}
      </View>

      {hasMore && status === "ready" ? (
        <Pressable
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={onLoadMore}
          style={eddieThreadStyles.previousLink}
        >
          {loadingMore ? (
            <ActivityIndicator color={theme.dividerText} size={14} />
          ) : (
            <Text
              style={[
                eddieThreadStyles.previousText,
                { color: theme.dividerText },
              ]}
            >
              Load more eddies
            </Text>
          )}
        </Pressable>
      ) : null}

      <MoreMenu
        anchor={menu?.anchor ?? null}
        entries={menu ? DELETE_ENTRY : []}
        onAction={(action) => {
          if (action.type === "delete" && menu) {
            setDeleteTarget(menu.commentId);
          }
        }}
        onClose={() => setMenu(null)}
      />
      <DeleteEddieDialog
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete();
        }}
        open={deleteTarget !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  composerReels: { paddingHorizontal: 0, paddingTop: 4 },
  field: {
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    minHeight: 88,
    padding: 12,
    textAlignVertical: "top",
  },
  signIn: { fontFamily: "SofiaProMed", fontSize: 14 },
  submit: { alignSelf: "flex-end" },
});
