"use client";

// oxlint-disable react/todo -- The current React Compiler lint cannot lower the async try/catch/finally blocks used for visible request and retry states.
// oxlint-disable no-await-in-loop -- Catch-up history pages depend on the cursor returned by the previous page.
// oxlint-disable no-nested-ternary, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, no-void -- Timeline states use compact JSX branches and event handlers intentionally detach requests that manage their own errors.

import type {
  CommunityChatChange,
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatMemberOption,
  CommunityChatPermissions,
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
import { mergeCommunityChatTimeline } from "@asm/messages";
import { Avatar, AvatarFallback, AvatarImage } from "@asm/ui/shadui/avatar";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@asm/ui/shadui/sheet";
import { Textarea } from "@asm/ui/shadui/textarea";
import {
  ArrowDown,
  Hash,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
  Pin,
  Reply,
  Megaphone,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";
import {
  captureCommunityChatAnchor,
  centerCommunityChatMessage,
  restoreCommunityChatAnchor,
} from "@/lib/communities/chat-viewport";
import type { CommunityChatViewportAnchor } from "@/lib/communities/chat-viewport";

import CommunityAvatar from "../card/community-avatar";
import CommunityRoleBadge, {
  isCommunityBadgedRole,
} from "../card/community-role-badge";
import CommunityChannelSettings from "./community-channel-settings";
import CommunityChatMessageActions from "./community-chat-message-actions";
import JoinButton from "./join-button";

interface CommunityChatProps {
  accentColor: string;
  avatarUrl: string | null;
  channelId: string;
  threadId?: string;
  communityId: string;
  communityName: string;
  membership: {
    role: "MEMBER" | "MODERATOR" | "OWNER" | "PARTICIPANT";
    status: "ACTIVE" | "PENDING";
  } | null;
  slug: string;
}

interface ChatResponse extends CommunityChatMessagePage {
  permissions: CommunityChatPermissions;
  room: CommunityChatRoom;
}

interface ChannelResponse {
  channels: CommunityChatRoom[];
  permissions: CommunityChatPermissions;
}

interface ThreadResponse {
  threads: CommunityChatThreadSummary[];
}

interface MemberResponse {
  members: CommunityChatMemberOption[];
  nextCursor: string | null;
}

interface PendingDraft {
  clientId: string;
  content: string;
  replyToId?: string;
}

function displayName(user: CommunityChatMessage["sender"]): string {
  return user.displayName.trim() || user.username;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sameLocalDay(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function subscribeToChatForeground(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  };
}

function chatIsForeground() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function chatServerForeground() {
  return false;
}

export default function CommunityChat(props: CommunityChatProps) {
  const { user } = useSession();
  return (
    <CommunityChatTimeline
      key={`${user?.id ?? "guest"}:${props.slug}:${props.threadId ?? props.channelId}`}
      {...props}
    />
  );
}

function CommunityChatTimeline({
  accentColor,
  avatarUrl,
  channelId,
  threadId,
  communityId,
  communityName,
  membership,
  slug,
}: CommunityChatProps) {
  const router = useRouter();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const viewerPresent = useSyncExternalStore(
    subscribeToChatForeground,
    chatIsForeground,
    chatServerForeground
  );
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atLatestRef = useRef(true);
  const windowAtLiveTail = useRef(true);
  const latestSequence = useRef("0");
  const latestChangeSequence = useRef("0");
  const lastReadSequence = useRef("0");
  const viewportAnchor = useRef<CommunityChatViewportAnchor | null>(null);
  const targetMessage = useRef<string | null>(null);
  const [channels, setChannels] = useState<CommunityChatRoom[]>([]);
  const [threads, setThreads] = useState<CommunityChatThreadSummary[]>([]);
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [permissions, setPermissions] =
    useState<CommunityChatPermissions | null>(null);
  const [room, setRoom] = useState<CommunityChatRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<CommunityChatMessage | null>(
    null
  );
  const [publicThreadSource, setPublicThreadSource] =
    useState<CommunityChatMessage | null>(null);
  const [publicThreadName, setPublicThreadName] = useState("");
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<CommunityChatMessage[]>(
    []
  );
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsError, setPinsError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [atLatest, setAtLatest] = useState(true);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"ANNOUNCEMENT" | "TEXT">(
    "TEXT"
  );
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [privateThreadOpen, setPrivateThreadOpen] = useState(false);
  const [privateThreadName, setPrivateThreadName] = useState("");
  const [privateThreadStarter, setPrivateThreadStarter] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberOptions, setMemberOptions] = useState<
    CommunityChatMemberOption[]
  >([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);
  const publicThreadRequestId = useRef<string | null>(null);
  const privateThreadRequestId = useRef<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [savingMessage, setSavingMessage] = useState(false);
  const [followingThread, setFollowingThread] = useState(false);
  const [savingThreadPreference, setSavingThreadPreference] = useState(false);
  const latestFetch = useRef<Promise<void> | null>(null);

  const channelsUrl = `/api/communities/${slug}/chat/channels`;
  const roomUrl = `/api/communities/${slug}/chat/rooms/${threadId ?? channelId}`;
  const threadsUrl = `/api/communities/${slug}/chat/rooms/${channelId}/threads`;
  const followingUrl = threadId
    ? `/api/communities/${slug}/chat/threads/${threadId}/following`
    : null;

  const appendMessages = useCallback((newMessages: CommunityChatMessage[]) => {
    if (newMessages.length === 0) {
      return;
    }
    if (!atLatestRef.current && transcriptRef.current) {
      viewportAnchor.current = captureCommunityChatAnchor(
        transcriptRef.current
      );
    }
    for (const message of newMessages) {
      if (BigInt(message.sequence) > BigInt(latestSequence.current)) {
        latestSequence.current = message.sequence;
        if (!atLatestRef.current) {
          setHasNewActivity(true);
        }
      }
      if (
        BigInt(message.changeSequence) > BigInt(latestChangeSequence.current)
      ) {
        latestChangeSequence.current = message.changeSequence;
      }
    }
    setMessages((current) => {
      const window = mergeCommunityChatTimeline(current, newMessages, {
        edge: atLatestRef.current ? "newer" : "older",
      });
      if (window.trimmedBefore) {
        setHasOlder(true);
      }
      if (window.trimmedAfter) {
        windowAtLiveTail.current = false;
        setHasNewActivity(true);
      }
      return window.messages;
    });
  }, []);

  const fetchLatest = useCallback(async () => {
    if (latestFetch.current) {
      return latestFetch.current;
    }
    const request = (async () => {
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const search = `?after=${encodeURIComponent(latestSequence.current)}&limit=100`;
        const response = await fetch(`${roomUrl}/messages${search}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Couldn't refresh this channel");
        }
        const page = (await response.json()) as ChatResponse;
        setPermissions(page.permissions);
        setRoom(page.room);
        appendMessages(page.messages);
        if (!page.nextAfterSequence) {
          return;
        }
      }
      setHasNewActivity(true);
    })();
    latestFetch.current = request;
    try {
      await request;
    } finally {
      latestFetch.current = null;
    }
  }, [appendMessages, roomUrl]);

  const openWindow = useCallback(
    async (messageId?: string) => {
      const query = new URLSearchParams({ limit: "50" });
      if (messageId) {
        query.set("around", messageId);
      }
      const response = await fetch(`${roomUrl}/messages?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("This message is no longer available");
      }
      const page = (await response.json()) as ChatResponse;
      targetMessage.current = messageId ?? null;
      viewportAnchor.current = null;
      atLatestRef.current = !messageId;
      windowAtLiveTail.current =
        !messageId || page.messages.at(-1)?.sequence === page.room.nextSequence;
      setAtLatest(!messageId);
      setMessages((current) => {
        const ids = new Set(page.messages.map((message) => message.id));
        return mergeCommunityChatTimeline(
          current.filter((message) => ids.has(message.id)),
          page.messages,
          { edge: "newer" }
        ).messages;
      });
      setPermissions(page.permissions);
      setRoom(page.room);
      setHasOlder(page.nextBeforeSequence !== null);
      setHasNewActivity(
        Boolean(
          messageId && page.messages.at(-1)?.sequence !== page.room.nextSequence
        )
      );
      latestSequence.current = page.room.nextSequence;
      latestChangeSequence.current = page.room.changeSequence;
      const url = new URL(window.location.href);
      if (messageId) {
        url.searchParams.set("message", messageId);
      } else {
        url.searchParams.delete("message");
      }
      window.history.replaceState(null, "", url);
    },
    [roomUrl]
  );

  const refreshThreads = useCallback(async () => {
    const response = await fetch(threadsUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Couldn't refresh community threads");
    }
    const data = (await response.json()) as ThreadResponse;
    setThreads(data.threads);
  }, [threadsUrl]);

  const fetchChangedMessage = useCallback(
    async (messageId: string) => {
      const response = await fetch(
        `${roomUrl}/messages/${encodeURIComponent(messageId)}`,
        {
          cache: "no-store",
        }
      );
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { message: CommunityChatMessage };
      appendMessages([data.message]);
    },
    [appendMessages, roomUrl]
  );

  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- A route change immediately clears the previous room while the next snapshot loads.
    setLoading(true);
    setLoadError(null);
    setChannels([]);
    setMessages([]);
    setAtLatest(true);
    atLatestRef.current = true;
    setHasNewActivity(false);
    latestSequence.current = "0";
    latestChangeSequence.current = "0";
    lastReadSequence.current = "0";
    const load = async () => {
      try {
        const anchor = new URLSearchParams(window.location.search).get(
          "message"
        );
        const historyQuery = new URLSearchParams({ limit: "50" });
        if (anchor) {
          historyQuery.set("around", anchor);
        }
        const [channelsResponse, messagesResponse, threadsResponse] =
          await Promise.all([
            fetch(channelsUrl, { cache: "no-store" }),
            fetch(`${roomUrl}/messages?${historyQuery}`, { cache: "no-store" }),
            fetch(threadsUrl, { cache: "no-store" }),
          ]);
        if (
          !channelsResponse.ok ||
          !messagesResponse.ok ||
          !threadsResponse.ok
        ) {
          throw new Error("This conversation isn't available right now");
        }
        const [channelData, page, threadData] = await Promise.all([
          channelsResponse.json() as Promise<ChannelResponse>,
          messagesResponse.json() as Promise<ChatResponse>,
          threadsResponse.json() as Promise<ThreadResponse>,
        ]);
        if (cancelled) {
          return;
        }
        setChannels(channelData.channels);
        setThreads(threadData.threads);
        setPermissions(page.permissions);
        setRoom(page.room);
        setMessages(page.messages);
        setHasOlder(page.nextBeforeSequence !== null);
        latestSequence.current = page.room.nextSequence;
        latestChangeSequence.current = page.room.changeSequence;
        if (anchor) {
          windowAtLiveTail.current =
            page.messages.at(-1)?.sequence === page.room.nextSequence;
          targetMessage.current = anchor;
          atLatestRef.current = false;
          setAtLatest(false);
          setHasNewActivity(
            page.messages.at(-1)?.sequence !== page.room.nextSequence
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Couldn't load chat"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [channelsUrl, roomUrl, threadsUrl]);

  const roomReady = room !== null;
  useEffect(() => {
    if (!roomReady || loading) {
      return;
    }
    const eventsUrl = `${roomUrl}/events?after=${encodeURIComponent(latestChangeSequence.current)}`;
    const source = new EventSource(eventsUrl);
    const refresh = async (event: Event) => {
      const streamEvent = event as MessageEvent<string>;
      let change: CommunityChatChange | null = null;
      try {
        change = JSON.parse(streamEvent.data) as CommunityChatChange;
      } catch {
        change = null;
      }
      if (
        change?.changeSequence &&
        BigInt(change.changeSequence) > BigInt(latestChangeSequence.current)
      ) {
        latestChangeSequence.current = change.changeSequence;
      }
      if (event.type === "reset") {
        try {
          await openWindow(
            atLatestRef.current ? undefined : viewportAnchor.current?.messageId
          );
        } catch {
          setActionError(
            "Couldn't restore this conversation after reconnecting. Please try again."
          );
        }
        return;
      }
      if (change?.kind === "thread.created") {
        try {
          await refreshThreads();
        } catch {
          setActionError("Couldn't refresh community threads.");
        }
      }
      if (change?.kind === "room.updated") {
        try {
          const response = await fetch(channelsUrl, { cache: "no-store" });
          if (response.ok) {
            const data = (await response.json()) as ChannelResponse;
            setChannels(data.channels);
          }
        } catch {
          setActionError("Couldn't refresh community channels.");
        }
      }
      if (change?.kind === "thread.updated") {
        try {
          await refreshThreads();
        } catch {
          setActionError("Couldn't refresh community threads.");
        }
      }
      try {
        if (change?.message) {
          appendMessages([change.message]);
          return;
        }
        const messageId = change?.messageId;
        const isMessageMutation = typeof messageId === "string";
        const refreshRequest = isMessageMutation
          ? fetchChangedMessage(messageId)
          : fetchLatest();
        await refreshRequest;
      } catch {
        setActionError(
          "Live updates paused. Reconnect to refresh the channel."
        );
      }
    };
    source.addEventListener("change", refresh);
    source.addEventListener("reset", refresh);
    source.addEventListener("access-revoked", () => {
      source.close();
      setMessages([]);
      setThreads([]);
      setContent("");
      setPendingDraft(null);
      setPermissions(null);
      setLoadError("Your access to this conversation changed.");
    });
    source.addEventListener("open", () => setReconnecting(false));
    source.addEventListener("error", () => setReconnecting(true));
    return () => source.close();
  }, [
    channelsUrl,
    appendMessages,
    fetchChangedMessage,
    fetchLatest,
    loading,
    openWindow,
    refreshThreads,
    roomReady,
    roomUrl,
  ]);

  // oxlint-disable react/exhaustive-effect-dependencies -- Re-anchor when the bounded transcript window changes, including edits and removals.
  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    if (targetMessage.current) {
      centerCommunityChatMessage(transcript, targetMessage.current);
      targetMessage.current = null;
      viewportAnchor.current = captureCommunityChatAnchor(transcript);
    } else if (atLatest) {
      transcript.scrollTop = transcript.scrollHeight;
    } else if (viewportAnchor.current) {
      restoreCommunityChatAnchor(transcript, viewportAnchor.current);
    }
  }, [atLatest, messages]);
  // oxlint-enable react/exhaustive-effect-dependencies

  const latestVisibleSequence = messages.at(-1)?.sequence ?? null;
  useEffect(() => {
    if (
      !viewerPresent ||
      !permissions?.isMember ||
      !atLatest ||
      !latestVisibleSequence
    ) {
      return;
    }
    if (BigInt(latestVisibleSequence) <= BigInt(lastReadSequence.current)) {
      return;
    }
    lastReadSequence.current = latestVisibleSequence;
    const saveReadState = async () => {
      try {
        const response = await fetch(`${roomUrl}/read`, {
          body: JSON.stringify({ readSequence: latestVisibleSequence }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          lastReadSequence.current = "0";
        }
      } catch {
        lastReadSequence.current = "0";
      }
    };
    // oxlint-disable-next-line no-void -- The effect persists read state without blocking the transcript render.
    void saveReadState();
  }, [
    atLatest,
    latestVisibleSequence,
    permissions?.isMember,
    roomUrl,
    viewerPresent,
  ]);

  useEffect(() => {
    if (!followingUrl || !user) {
      return;
    }
    let cancelled = false;
    const loadFollowing = async () => {
      try {
        const response = await fetch(followingUrl, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const result = (await response.json()) as { following: boolean };
        if (!cancelled) {
          setFollowingThread(result.following);
        }
      } catch {
        if (!cancelled) {
          setFollowingThread(false);
        }
      }
    };
    // oxlint-disable-next-line no-void -- The follow preference loads alongside the selected thread.
    void loadFollowing();
    return () => {
      cancelled = true;
    };
  }, [followingUrl, user]);

  const updateThreadFollowing = useCallback(async () => {
    if (!followingUrl || savingThreadPreference) {
      return;
    }
    setSavingThreadPreference(true);
    try {
      const response = await fetch(followingUrl, {
        body: JSON.stringify({ following: !followingThread }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        throw new Error("Couldn't update this thread preference");
      }
      const result = (await response.json()) as { following: boolean };
      setFollowingThread(result.following);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't update this thread preference"
      );
    } finally {
      setSavingThreadPreference(false);
    }
  }, [followingThread, followingUrl, savingThreadPreference]);

  const loadOlder = useCallback(async () => {
    const [first] = messages;
    if (!first || loadingOlder || !hasOlder) {
      return;
    }
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `${roomUrl}/messages?before=${encodeURIComponent(first.sequence)}&limit=50`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("Couldn't load earlier messages");
      }
      const page = (await response.json()) as ChatResponse;
      setHasOlder(page.nextBeforeSequence !== null);
      if (transcriptRef.current && page.messages.length > 0) {
        viewportAnchor.current = captureCommunityChatAnchor(
          transcriptRef.current
        );
      }
      setMessages((current) => {
        const window = mergeCommunityChatTimeline(current, page.messages, {
          edge: "older",
        });
        if (window.trimmedAfter) {
          windowAtLiveTail.current = false;
          setHasNewActivity(true);
        }
        return window.messages;
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't load earlier messages"
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadingOlder, messages, roomUrl]);

  const onTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    const nearLatest =
      windowAtLiveTail.current &&
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <
        64;
    atLatestRef.current = nearLatest;
    viewportAnchor.current = captureCommunityChatAnchor(transcript);
    setAtLatest(nearLatest);
    if (nearLatest) {
      setHasNewActivity(false);
    } else if (transcript.scrollTop < 40 && hasOlder) {
      void loadOlder();
    }
  }, [hasOlder, loadOlder]);

  const send = useCallback(async () => {
    const outgoing = pendingDraft ?? {
      clientId: crypto.randomUUID(),
      content: content.trim(),
      replyToId: replyTarget?.id,
    };
    if (!outgoing.content || sending || !permissions?.canSend) {
      return;
    }
    setPendingDraft(outgoing);
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(`${roomUrl}/messages`, {
        body: JSON.stringify(outgoing),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Message didn't send");
      }
      const result = (await response.json()) as {
        message: CommunityChatMessage;
      };
      if (!atLatestRef.current) {
        try {
          await openWindow();
        } catch {
          setActionError(
            "Your message was sent. Reconnect to jump to the latest messages."
          );
        }
      }
      if (atLatestRef.current) {
        appendMessages([result.message]);
      } else {
        setHasNewActivity(true);
      }
      setContent("");
      setPendingDraft(null);
      setReplyTarget(null);
      if (atLatestRef.current) {
        setAtLatest(true);
        setHasNewActivity(false);
        requestAnimationFrame(() => {
          if (transcriptRef.current) {
            transcriptRef.current.scrollTop =
              transcriptRef.current.scrollHeight;
          }
        });
      }
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Message didn't send"
      );
      setPendingDraft(outgoing);
      setContent(outgoing.content);
    } finally {
      setSending(false);
    }
  }, [
    appendMessages,
    content,
    pendingDraft,
    openWindow,
    replyTarget,
    permissions?.canSend,
    roomUrl,
    sending,
  ]);

  const createChannel = useCallback(async () => {
    const name = newChannelName.trim();
    if (!name || creatingChannel) {
      return;
    }
    setCreatingChannel(true);
    try {
      const response = await fetch(channelsUrl, {
        body: JSON.stringify({ channelType: newChannelType, name }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Couldn't create channel");
      }
      const data = (await response.json()) as { channel: CommunityChatRoom };
      setChannels((current) => [...current, data.channel]);
      setNewChannelName("");
      setCreateChannelOpen(false);
      setMobileChannelsOpen(false);
      router.push(`/a/${slug}/chat/${data.channel.id}`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Couldn't create channel"
      );
    } finally {
      setCreatingChannel(false);
    }
  }, [
    channelsUrl,
    creatingChannel,
    newChannelName,
    newChannelType,
    router,
    slug,
  ]);

  useEffect(() => {
    const queryText = memberSearch.trim();
    if (!privateThreadOpen || queryText.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setMembersLoading(true);
      const query = new URLSearchParams({ limit: "20", q: queryText });
      try {
        const response = await fetch(
          `/api/communities/${slug}/chat/members?${query}`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error("Couldn't search community members");
        }
        const page = (await response.json()) as MemberResponse;
        if (!controller.signal.aborted) {
          setMemberOptions(page.members);
          setMemberCursor(page.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) {
          setMemberOptions([]);
          setMemberCursor(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setMembersLoading(false);
        }
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [memberSearch, privateThreadOpen, slug]);

  const loadMoreMembers = useCallback(async () => {
    if (!memberCursor || membersLoading || memberSearch.trim().length < 2) {
      return;
    }
    setMembersLoading(true);
    try {
      const query = new URLSearchParams({
        cursor: memberCursor,
        limit: "20",
        q: memberSearch.trim(),
      });
      const response = await fetch(
        `/api/communities/${slug}/chat/members?${query}`,
        {
          cache: "no-store",
        }
      );
      if (!response.ok) {
        throw new Error("Couldn't load more members");
      }
      const page = (await response.json()) as MemberResponse;
      setMemberOptions((current) => [...current, ...page.members]);
      setMemberCursor(page.nextCursor);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Couldn't load more members"
      );
    } finally {
      setMembersLoading(false);
    }
  }, [memberCursor, memberSearch, membersLoading, slug]);

  const createPublicThread = useCallback(
    async (sourceMessageId: string) => {
      if (creatingThread) {
        return;
      }
      setCreatingThread(true);
      setActionError(null);
      publicThreadRequestId.current ??= crypto.randomUUID();
      try {
        const response = await fetch(threadsUrl, {
          body: JSON.stringify({
            clientId: publicThreadRequestId.current,
            name: publicThreadName.trim(),
            sourceMessageId,
            visibility: "PUBLIC",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          thread?: CommunityChatRoom;
        } | null;
        if (!response.ok || !data?.thread) {
          throw new Error(data?.error ?? "Couldn't start a thread");
        }
        router.push(`/a/${slug}/chat/${channelId}/threads/${data.thread.id}`);
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Couldn't start a thread"
        );
      } finally {
        setCreatingThread(false);
      }
    },
    [channelId, creatingThread, publicThreadName, router, slug, threadsUrl]
  );

  const createPrivateThread = useCallback(async () => {
    if (
      creatingThread ||
      !privateThreadName.trim() ||
      !privateThreadStarter.trim()
    ) {
      return;
    }
    setCreatingThread(true);
    setActionError(null);
    privateThreadRequestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(threadsUrl, {
        body: JSON.stringify({
          clientId: privateThreadRequestId.current,
          inviteeUserIds: selectedMemberIds,
          name: privateThreadName.trim(),
          starterContent: privateThreadStarter,
          visibility: "PRIVATE",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        thread?: CommunityChatRoom;
      } | null;
      if (!response.ok || !data?.thread) {
        throw new Error(data?.error ?? "Couldn't create a private thread");
      }
      setPrivateThreadOpen(false);
      privateThreadRequestId.current = null;
      setPrivateThreadName("");
      setPrivateThreadStarter("");
      setMemberSearch("");
      setMemberOptions([]);
      setMemberCursor(null);
      setSelectedMemberIds([]);
      router.push(`/a/${slug}/chat/${channelId}/threads/${data.thread.id}`);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't create a private thread"
      );
    } finally {
      setCreatingThread(false);
    }
  }, [
    channelId,
    creatingThread,
    privateThreadName,
    privateThreadStarter,
    router,
    selectedMemberIds,
    slug,
    threadsUrl,
  ]);

  const saveMessageEdit = useCallback(
    async (message: CommunityChatMessage) => {
      if (savingMessage || !editContent.trim()) {
        return;
      }
      setSavingMessage(true);
      setActionError(null);
      try {
        const response = await fetch(
          `/api/communities/${slug}/chat/messages/${message.id}`,
          {
            body: JSON.stringify({
              content: editContent,
              revision: message.revision,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }
        );
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          message?: CommunityChatMessage;
        } | null;
        if (!response.ok || !data?.message) {
          throw new Error(data?.error ?? "Couldn't edit this message");
        }
        appendMessages([data.message]);
        setEditingMessageId(null);
        setEditContent("");
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Couldn't edit this message"
        );
      } finally {
        setSavingMessage(false);
      }
    },
    [appendMessages, editContent, savingMessage, slug]
  );

  const removeMessage = useCallback(
    async (message: CommunityChatMessage) => {
      if (savingMessage) {
        return;
      }
      setSavingMessage(true);
      setActionError(null);
      try {
        const response = await fetch(
          `/api/communities/${slug}/chat/messages/${message.id}`,
          {
            body: JSON.stringify({ revision: message.revision }),
            headers: { "content-type": "application/json" },
            method: "DELETE",
          }
        );
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          message?: CommunityChatMessage;
        } | null;
        if (!response.ok || !data?.message) {
          throw new Error(data?.error ?? "Couldn't remove this message");
        }
        appendMessages([data.message]);
        setConfirmDeleteId(null);
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Couldn't remove this message"
        );
      } finally {
        setSavingMessage(false);
      }
    },
    [appendMessages, savingMessage, slug]
  );

  const loadPins = useCallback(async () => {
    setPinsLoading(true);
    setPinsError(null);
    try {
      const response = await fetch(`${roomUrl}/pins`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Couldn't load pinned messages");
      }
      const result = (await response.json()) as {
        messages: CommunityChatMessage[];
      };
      setPinnedMessages(result.messages);
    } catch (error) {
      setPinsError(
        error instanceof Error ? error.message : "Couldn't load pinned messages"
      );
    } finally {
      setPinsLoading(false);
    }
  }, [roomUrl]);

  const reactToMessage = useCallback(
    async (message: CommunityChatMessage, emoji: string) => {
      try {
        const response = await fetch(`${roomUrl}/reactions`, {
          body: JSON.stringify({
            emoji,
            messageId: message.id,
            reacted: !message.reactions?.some(
              (reaction) => reaction.emoji === emoji && reaction.reacted
            ),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Couldn't update your reaction");
        }
        await fetchChangedMessage(message.id);
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Couldn't update your reaction"
        );
      }
    },
    [fetchChangedMessage, roomUrl]
  );

  const pinMessage = useCallback(
    async (message: CommunityChatMessage) => {
      try {
        const response = await fetch(`${roomUrl}/pins`, {
          body: JSON.stringify({
            messageId: message.id,
            pinned: !message.pinned,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        });
        if (!response.ok) {
          throw new Error("Couldn't update this pin");
        }
        await fetchChangedMessage(message.id);
        if (pinsOpen) {
          await loadPins();
        }
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Couldn't update this pin"
        );
      }
    },
    [fetchChangedMessage, loadPins, pinsOpen, roomUrl]
  );

  const copyMessageLink = useCallback(async (messageId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("message", messageId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setStatusMessage("Message link copied");
    } catch {
      setActionError("Couldn't copy the message link. Please try again.");
    }
  }, []);

  const jumpToMessage = useCallback(
    async (messageId?: string) => {
      try {
        await openWindow(messageId);
        setPinsOpen(false);
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Couldn't open this message"
        );
      }
    },
    [openWindow]
  );

  const startPublicThread = useCallback((message: CommunityChatMessage) => {
    publicThreadRequestId.current = crypto.randomUUID();
    setPublicThreadSource(message);
    setPublicThreadName(
      message.payload?.type === "text"
        ? message.payload.content.split("\n")[0]?.slice(0, 64).trim() ||
            "New thread"
        : "New thread"
    );
    setActionError(null);
  }, []);

  const sortedMessages = messages;
  const channelName = room?.name ?? "conversation";
  const canManage = permissions?.canManage ?? false;
  const canSend = permissions?.canSend ?? false;
  const threadRoot = threadId
    ? threads.find((thread) => thread.room.id === threadId)?.sourceMessage
    : null;
  const restrictionCopy = {
    ANNOUNCEMENT:
      "Only community owners and moderators can post in this announcement channel.",
    ARCHIVED: "This conversation is archived. Its history is still available.",
    BANNED: "You are banned from contributing to this community.",
    JOIN: "Join this community to send messages.",
    LOCKED:
      "Community staff have locked this conversation. You can still read its history.",
    PENDING:
      "Your membership request is waiting for approval. You can read public channels while you wait.",
    TIMEOUT:
      "You are timed out from contributing to this community. You can still read along.",
  };

  const channelList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 pt-3 pr-16 pb-2 pl-3 md:pr-3">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
            Channels
          </p>
          <p className="text-foreground mt-1 text-sm font-semibold">
            In this community
          </p>
        </div>
        {canManage ? (
          <Button
            aria-label="Create channel"
            className="icon-btn-3d size-8 rounded-full"
            onClick={() => setCreateChannelOpen((open) => !open)}
            size="icon"
            variant="ghost"
          >
            {createChannelOpen ? (
              <X className="size-4" />
            ) : (
              <Plus className="size-4" />
            )}
          </Button>
        ) : null}
      </div>
      {createChannelOpen && canManage ? (
        <div className="border-border/70 mx-3 mb-3 rounded-xl border bg-[hsl(var(--background))] p-3">
          <label
            className="text-muted-foreground mb-1.5 block text-xs font-medium"
            htmlFor="community-channel-name"
          >
            Channel name
          </label>
          <Input
            autoFocus
            id="community-channel-name"
            maxLength={64}
            onChange={(event) => setNewChannelName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void createChannel();
              }
            }}
            placeholder="updates"
            value={newChannelName}
          />
          <div className="mt-2 flex gap-1.5">
            {(["TEXT", "ANNOUNCEMENT"] as const).map((type) => (
              <button
                aria-pressed={newChannelType === type}
                className={`chip-3d rounded-full px-2.5 py-1 text-[11px] ${newChannelType === type ? "text-foreground" : "text-muted-foreground"}`}
                key={type}
                onClick={() => setNewChannelType(type)}
                type="button"
              >
                {type === "TEXT" ? "Text" : "Announcement"}
              </button>
            ))}
          </div>
          <Button
            className="mt-3 h-8 w-full text-xs"
            disabled={!newChannelName.trim() || creatingChannel}
            onClick={async () => {
              await createChannel();
            }}
            variant="premium"
          >
            {creatingChannel ? "Creating…" : "Create channel"}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {channels.map((channel) => (
          <button
            aria-current={channel.id === channelId ? "page" : undefined}
            className={`group relative mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${channel.id === channelId ? "text-foreground bg-[color-mix(in_srgb,var(--community-accent-resolved)_12%,hsl(var(--background)))]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
            key={channel.id}
            onClick={() => {
              setMobileChannelsOpen(false);
              router.push(`/a/${slug}/chat/${channel.id}`);
            }}
            type="button"
          >
            <Hash className="size-4 shrink-0 opacity-75" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {channel.name}
            </span>
            {channel.channelType === "ANNOUNCEMENT" ? (
              <span className="text-[9px] font-bold tracking-wide uppercase opacity-55">
                Staff
              </span>
            ) : null}
            {channel.id === channelId ? (
              <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--community-accent-resolved)]" />
            ) : null}
          </button>
        ))}
        <div className="border-border/50 mt-4 border-t px-1 pt-3">
          <p className="text-muted-foreground px-2 pb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Threads in this channel
          </p>
          {threads.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 text-xs leading-relaxed">
              Threads started in this channel appear here.
            </p>
          ) : (
            threads.map((thread) => (
              <button
                aria-current={threadId === thread.room.id ? "page" : undefined}
                className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${threadId === thread.room.id ? "text-foreground bg-[color-mix(in_srgb,var(--community-accent-resolved)_12%,hsl(var(--background)))]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                key={thread.room.id}
                onClick={() => {
                  setMobileChannelsOpen(false);
                  router.push(
                    `/a/${slug}/chat/${channelId}/threads/${thread.room.id}`
                  );
                }}
                type="button"
              >
                {thread.room.visibility === "PRIVATE" ? (
                  <LockKeyhole className="size-3.5 shrink-0" />
                ) : (
                  <MessageCircle className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {thread.room.name}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="border-border/60 border-t px-4 py-3">
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Channels bring the community together. Follow threads to keep up with
          a conversation.
        </p>
      </div>
    </div>
  );

  const callToChat = canSend ? null : (
    <div className="border-border/60 bg-muted/35 mx-4 mb-3 rounded-2xl border px-4 py-3 text-sm">
      {membership || permissions?.writeRestriction === "BANNED" ? (
        <p className="text-muted-foreground">
          {permissions?.writeRestriction
            ? restrictionCopy[permissions.writeRestriction]
            : "You can read this conversation, but sending messages is unavailable right now."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-foreground font-semibold">
              Join the conversation
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Become a member to write in this community.
            </p>
          </div>
          {isLoggedIn ? (
            <JoinButton
              className="w-auto"
              communityId={communityId}
              initialMembership={membership}
              isLoggedIn
              slug={slug}
            />
          ) : (
            <Button asChild className="w-auto" size="sm" variant="premium">
              <Link href="/login">Sign in to join</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section
      aria-label={`${communityName} chat`}
      className="community-accent-scope relative flex min-h-0 flex-1 flex-col"
      style={communityAccentStyle(accentColor) as CSSProperties}
    >
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPublicThreadSource(null);
          }
        }}
        open={publicThreadSource !== null}
      >
        <DialogContent
          className="community-accent-scope sm:max-w-lg"
          style={communityAccentStyle(accentColor)}
        >
          <DialogHeader>
            <DialogTitle>Start a thread</DialogTitle>
            <DialogDescription>
              Give this conversation a name. Everyone with access to #
              {channels.find((channel) => channel.id === channelId)?.name ??
                channelName}{" "}
              can read and join it.
            </DialogDescription>
          </DialogHeader>
          {publicThreadSource?.payload?.type === "text" ? (
            <blockquote className="border-l-2 border-[var(--community-accent-resolved)] pl-3 text-sm">
              <span className="text-foreground mb-1 block font-semibold">
                {displayName(publicThreadSource.sender)}
              </span>
              <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                {publicThreadSource.payload.content}
              </p>
            </blockquote>
          ) : null}
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (publicThreadSource) {
                await createPublicThread(publicThreadSource.id);
              }
            }}
          >
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="public-thread-name"
            >
              Thread name
              <Input
                id="public-thread-name"
                autoFocus
                maxLength={64}
                onChange={(event) => setPublicThreadName(event.target.value)}
                required
                value={publicThreadName}
              />
            </label>
            {actionError ? (
              <p className="text-destructive text-sm" role="alert">
                {actionError}
              </p>
            ) : null}
            <Button
              disabled={creatingThread || !publicThreadName.trim()}
              type="submit"
              variant="premium"
            >
              {creatingThread ? "Starting…" : "Start thread"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          setPinsOpen(open);
          if (open) {
            void loadPins();
          }
        }}
        open={pinsOpen}
      >
        <DialogContent
          className="community-accent-scope max-h-[80dvh] overflow-y-auto sm:max-w-xl"
          style={communityAccentStyle(accentColor)}
        >
          <DialogHeader>
            <DialogTitle>Pinned messages</DialogTitle>
            <DialogDescription>
              Messages community staff saved in{" "}
              {room?.kind === "THREAD" ? channelName : `#${channelName}`}.
            </DialogDescription>
          </DialogHeader>
          {pinsLoading ? (
            <output className="text-muted-foreground block py-6 text-sm">
              Loading pinned messages…
            </output>
          ) : pinsError ? (
            <div role="alert">
              <p className="text-destructive text-sm">{pinsError}</p>
              <Button onClick={loadPins} variant="ghost">
                Try again
              </Button>
            </div>
          ) : pinnedMessages.length === 0 ? (
            <div className="py-8 text-center">
              <Pin className="text-muted-foreground mx-auto mb-3 size-6" />
              <p className="font-semibold">No pinned messages yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Useful links and community updates can live here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {pinnedMessages.map((message) => (
                <button
                  className="surface-3d rounded-xl! p-4 text-left"
                  key={message.id}
                  onClick={() => void jumpToMessage(message.id)}
                  type="button"
                >
                  <span className="text-foreground block text-sm font-bold">
                    {displayName(message.sender)}
                  </span>
                  <span className="text-muted-foreground mt-1 line-clamp-4 block text-sm whitespace-pre-wrap">
                    {message.payload?.type === "text"
                      ? message.payload.content
                      : "Message"}
                  </span>
                  <span className="mt-3 block text-xs font-medium text-[var(--community-accent-resolved)]">
                    Jump to message →
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="border-border/60 flex min-h-0 flex-1 overflow-hidden border-b">
        <aside className="surface-3d hidden w-60 shrink-0 flex-col rounded-none! md:flex">
          {channelList}
        </aside>

        <Sheet onOpenChange={setMobileChannelsOpen} open={mobileChannelsOpen}>
          <SheetContent
            className="community-accent-scope flex w-[min(20rem,90vw)] flex-col gap-0 p-0"
            style={communityAccentStyle(accentColor)}
            side="left"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{communityName} channels</SheetTitle>
              <SheetDescription>
                Choose a channel or a thread in this community.
              </SheetDescription>
            </SheetHeader>
            {channelList}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-border/60 flex min-h-14 items-center gap-3 border-b px-3 sm:px-5">
            <Button
              aria-label="Browse community channels"
              className="icon-btn-3d size-9 rounded-full md:hidden"
              onClick={() => setMobileChannelsOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu className="size-4" />
            </Button>
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--community-accent-resolved)_13%,hsl(var(--background)))] text-[var(--community-accent-resolved)]">
              {room?.kind === "THREAD" ? (
                <MessageCircle className="size-[18px]" />
              ) : room?.channelType === "ANNOUNCEMENT" ? (
                <Megaphone className="size-[18px]" />
              ) : (
                <Hash className="size-[18px]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-foreground truncate text-sm font-bold">
                {room?.kind === "THREAD" ? channelName : `#${channelName}`}
              </h2>
              <p className="text-muted-foreground truncate text-[11px]">
                {reconnecting
                  ? "Reconnecting…"
                  : room?.kind === "THREAD"
                    ? `${room.visibility === "PRIVATE" ? "Private thread" : "Thread"} in #${channels.find((channel) => channel.id === channelId)?.name ?? "community"}`
                    : room?.topic || `A conversation in ${communityName}`}
              </p>
            </div>
            {room?.channelType === "ANNOUNCEMENT" ? (
              <span className="chip-3d text-muted-foreground hidden rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase sm:inline-flex">
                Announcement
              </span>
            ) : null}
            <Button
              aria-label="Pinned messages"
              className="size-9 shrink-0 rounded-full"
              onClick={() => {
                setPinsOpen(true);
                void loadPins();
              }}
              size="icon"
              variant="ghost"
            >
              <Pin className="size-4" />
            </Button>
            {canManage && room?.kind === "CHANNEL" ? (
              <CommunityChannelSettings
                canArchive={channels.length > 1}
                onUpdated={(updated) => {
                  setChannels((current) =>
                    current
                      .map((channel) =>
                        channel.id === updated.id ? updated : channel
                      )
                      .filter((channel) => !channel.archived)
                      .toSorted(
                        (left, right) => left.sortOrder - right.sortOrder
                      )
                  );
                  setRoom(updated);
                  if (updated.archived) {
                    router.push(`/a/${slug}/chat`);
                  }
                }}
                room={room}
                slug={slug}
              />
            ) : null}
            {threadId && permissions?.isMember ? (
              <Button
                className="h-8 rounded-full px-3 text-xs"
                disabled={savingThreadPreference}
                onClick={updateThreadFollowing}
                variant={followingThread ? "ghost" : "premium"}
              >
                {followingThread ? "Following" : "Follow thread"}
              </Button>
            ) : null}
            {!threadId && canSend ? (
              <Button
                aria-label="Start private thread"
                className="h-9 w-9 shrink-0 rounded-full p-0 sm:h-8 sm:w-auto sm:px-3 sm:text-xs"
                onClick={() => setPrivateThreadOpen((open) => !open)}
                variant="ghost"
              >
                <LockKeyhole className="size-4 sm:mr-1.5 sm:size-3.5" />
                <span className="hidden sm:inline">Private thread</span>
              </Button>
            ) : threadId ? (
              <Button
                asChild
                className="h-8 rounded-full px-3 text-xs"
                variant="ghost"
              >
                <Link href={`/a/${slug}/chat/${channelId}`}>
                  Back to channel
                </Link>
              </Button>
            ) : null}
          </header>
          {actionError || statusMessage ? (
            <div
              className="border-border/60 flex items-center justify-between gap-3 border-b px-4 py-2 text-xs"
              role={actionError ? "alert" : "status"}
            >
              <span
                className={
                  actionError ? "text-destructive" : "text-muted-foreground"
                }
              >
                {actionError ?? statusMessage}
              </span>
              <Button
                aria-label="Dismiss message"
                className="size-7 shrink-0"
                onClick={() => {
                  setActionError(null);
                  setStatusMessage(null);
                }}
                size="icon"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : null}
          {threadRoot ? (
            <div className="border-border/60 bg-muted/20 border-b px-5 py-3">
              <p className="text-muted-foreground mb-1 text-[11px]">
                Thread started by{" "}
                <span className="text-foreground font-semibold">
                  {displayName(threadRoot.sender)}
                </span>
              </p>
              <p className="text-foreground/80 line-clamp-2 text-sm whitespace-pre-wrap">
                {threadRoot.payload?.type === "text"
                  ? threadRoot.payload.content
                  : "The original message was deleted. Replies remain in this thread."}
              </p>
            </div>
          ) : null}

          {privateThreadOpen && !threadId ? (
            <div className="border-border/60 mx-3 mt-3 rounded-2xl border bg-[hsl(var(--background))] p-4 shadow-sm sm:mx-5">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-foreground text-sm font-bold">
                    Start a private thread
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Only invited active members and community staff can read
                    this conversation.
                  </p>
                </div>
                <Button
                  aria-label="Close private thread form"
                  className="icon-btn-3d size-8 rounded-full"
                  onClick={() => {
                    setPrivateThreadOpen(false);
                    privateThreadRequestId.current = null;
                    setMemberOptions([]);
                    setMemberCursor(null);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="grid gap-2">
                <Input
                  aria-label="Private thread name"
                  maxLength={64}
                  onChange={(event) => setPrivateThreadName(event.target.value)}
                  placeholder="What’s this conversation about?"
                  value={privateThreadName}
                />
                <Textarea
                  aria-label="Private thread starter message"
                  className="min-h-16 resize-y text-sm"
                  maxLength={4000}
                  onChange={(event) =>
                    setPrivateThreadStarter(event.target.value)
                  }
                  placeholder="Add a first message"
                  value={privateThreadStarter}
                />
                <Input
                  aria-label="Find community members to invite"
                  autoComplete="off"
                  onChange={(event) => {
                    const query = event.target.value;
                    setMemberSearch(query);
                    if (query.trim().length < 2) {
                      setMemberOptions([]);
                      setMemberCursor(null);
                    }
                  }}
                  placeholder="Find members by name or username"
                  value={memberSearch}
                />
                {selectedMemberIds.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {selectedMemberIds.length} member
                    {selectedMemberIds.length === 1 ? "" : "s"} invited
                  </p>
                ) : null}
                {membersLoading ? (
                  <p className="text-muted-foreground text-xs">
                    Searching members…
                  </p>
                ) : null}
                <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                  {memberOptions.map((member) => {
                    const selected = selectedMemberIds.includes(member.id);
                    return (
                      <button
                        aria-pressed={selected}
                        className={`chip-3d rounded-full px-3 py-1.5 text-xs ${selected ? "text-foreground" : "text-muted-foreground"}`}
                        key={member.id}
                        onClick={() =>
                          setSelectedMemberIds((current) =>
                            selected
                              ? current.filter((id) => id !== member.id)
                              : [...current, member.id]
                          )
                        }
                        type="button"
                      >
                        {member.displayName}{" "}
                        <span className="opacity-60">@{member.username}</span>
                      </button>
                    );
                  })}
                </div>
                {memberCursor ? (
                  <Button
                    className="h-8 w-fit text-xs"
                    disabled={membersLoading}
                    onClick={async () => {
                      await loadMoreMembers();
                    }}
                    variant="ghost"
                  >
                    Show more members
                  </Button>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    disabled={
                      creatingThread ||
                      !privateThreadName.trim() ||
                      !privateThreadStarter.trim()
                    }
                    onClick={async () => {
                      await createPrivateThread();
                    }}
                    variant="premium"
                  >
                    {creatingThread
                      ? "Opening thread…"
                      : "Create private thread"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {loadError ? (
            <div className="border-destructive/25 bg-destructive/5 m-4 rounded-2xl border p-4">
              <p className="text-foreground text-sm font-semibold">
                Chat didn’t load
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{loadError}</p>
              <Button
                className="mt-3 h-8"
                onClick={() => router.refresh()}
                variant="premium"
              >
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div
                aria-live="polite"
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 [overflow-anchor:none] sm:px-5"
                onScroll={onTranscriptScroll}
                ref={transcriptRef}
                role="log"
                aria-label={`${channelName} messages`}
              >
                {loadingOlder ? (
                  <p className="text-muted-foreground mb-3 text-center text-xs">
                    Finding earlier messages…
                  </p>
                ) : null}
                {loading ? (
                  <div className="m-auto flex flex-col items-center gap-3 py-12 text-center">
                    <div className="bg-muted size-9 animate-pulse rounded-full" />
                    <p className="text-muted-foreground text-sm">
                      Opening the channel…
                    </p>
                  </div>
                ) : sortedMessages.length === 0 ? (
                  <div className="m-auto max-w-sm py-16 text-center">
                    <CommunityAvatar
                      accentColor={accentColor}
                      avatarUrl={avatarUrl}
                      className="mx-auto size-14"
                      name={communityName}
                      slug={slug}
                    />
                    <p className="text-foreground mt-4 text-base font-bold">
                      A fresh place to start
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Welcome to #{channelName}. Say hello to the community.
                    </p>
                  </div>
                ) : (
                  <div className="mt-auto space-y-1 pb-2">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="bg-border/70 h-px flex-1" />
                      <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.13em] uppercase">
                        {threadId ? "Thread history" : "Channel history"}
                      </span>
                      <div className="bg-border/70 h-px flex-1" />
                    </div>
                    {sortedMessages.map((message, index) => {
                      const previous = sortedMessages[index - 1];
                      const linkedThread = threads.find(
                        (thread) => thread.sourceMessage?.id === message.id
                      );
                      const isGrouped = Boolean(
                        previous &&
                        previous.senderId === message.senderId &&
                        sameLocalDay(previous.createdAt, message.createdAt) &&
                        new Date(message.createdAt).getTime() -
                          new Date(previous.createdAt).getTime() <
                          5 * 60_000
                      );
                      const showDay =
                        !previous ||
                        !sameLocalDay(previous.createdAt, message.createdAt);
                      return (
                        <div key={message.id}>
                          {showDay ? (
                            <div className="my-5 flex items-center gap-3">
                              <div className="bg-border/60 h-px flex-1" />
                              <span className="text-muted-foreground text-[11px] font-medium">
                                {formatDay(message.createdAt)}
                              </span>
                              <div className="bg-border/60 h-px flex-1" />
                            </div>
                          ) : null}
                          <article
                            data-chat-message-id={message.id}
                            className={`group hover:bg-muted/35 relative flex gap-3 rounded-xl px-2 py-1.5 transition-colors ${isGrouped ? "pt-0.5" : "mt-2"}`}
                          >
                            {!message.deletedAt ? (
                              <CommunityChatMessageActions
                                canManage={canManage}
                                canSend={canSend}
                                isOwn={user?.id === message.senderId}
                                onCopyLink={() =>
                                  void copyMessageLink(message.id)
                                }
                                onDelete={() => setConfirmDeleteId(message.id)}
                                onEdit={() => {
                                  setEditingMessageId(message.id);
                                  setEditContent(
                                    message.payload?.type === "text"
                                      ? message.payload.content
                                      : ""
                                  );
                                }}
                                onPin={() => void pinMessage(message)}
                                onReact={(emoji) =>
                                  void reactToMessage(message, emoji)
                                }
                                onReply={() => {
                                  setReplyTarget(message);
                                  setPendingDraft(null);
                                  composerRef.current?.focus();
                                }}
                                onStartThread={
                                  !threadId && !linkedThread
                                    ? () => startPublicThread(message)
                                    : undefined
                                }
                                pinned={message.pinned ?? false}
                              />
                            ) : null}
                            <div className="w-9 shrink-0">
                              {!isGrouped ? (
                                <Avatar className="ring-border/60 size-9 ring-1">
                                  <AvatarImage
                                    alt=""
                                    src={message.sender.avatarUrl ?? undefined}
                                  />
                                  <AvatarFallback className="text-xs font-bold">
                                    {displayName(message.sender)
                                      .slice(0, 1)
                                      .toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              {!isGrouped ? (
                                <div className="mb-0.5 flex min-h-8 flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-20 sm:min-h-0 sm:pr-0">
                                  <span className="text-foreground text-[13px] font-bold">
                                    {displayName(message.sender)}
                                  </span>
                                  {isCommunityBadgedRole(
                                    message.sender.role
                                  ) ? (
                                    <CommunityRoleBadge
                                      className="h-4 w-12"
                                      communityName={communityName}
                                      roleValue={message.sender.role}
                                    />
                                  ) : null}
                                  <span className="text-muted-foreground text-[10px]">
                                    @{message.sender.username}
                                  </span>
                                  <time
                                    className="text-muted-foreground text-[10px]"
                                    dateTime={message.createdAt}
                                  >
                                    {formatTime(message.createdAt)}
                                  </time>
                                  {message.editedAt ? (
                                    <span className="text-muted-foreground text-[10px]">
                                      edited
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <time
                                  className="text-muted-foreground invisible text-[10px] group-hover:visible"
                                  dateTime={message.createdAt}
                                >
                                  {formatTime(message.createdAt)}
                                </time>
                              )}
                              {message.replyTo ? (
                                <button
                                  className="text-muted-foreground hover:text-foreground mb-1.5 flex max-w-full items-center gap-1.5 text-left text-xs"
                                  onClick={() =>
                                    void jumpToMessage(message.replyTo?.id)
                                  }
                                  type="button"
                                >
                                  <Reply className="size-3 shrink-0" />
                                  <span className="shrink-0 font-semibold">
                                    {message.replyTo.senderName}
                                  </span>
                                  <span className="truncate">
                                    {message.replyTo.deleted
                                      ? "Original message deleted"
                                      : (message.replyTo.content ?? "Message")}
                                  </span>
                                </button>
                              ) : null}
                              {message.pinned ? (
                                <span className="text-muted-foreground mb-1 flex items-center gap-1 text-[10px]">
                                  <Pin className="size-2.5" />
                                  Pinned message
                                </span>
                              ) : null}
                              {message.payload?.type === "text" ? (
                                <p className="text-foreground/90 text-[13px] leading-[1.55] break-words whitespace-pre-wrap">
                                  {message.payload.content}
                                </p>
                              ) : message.deletedAt ? (
                                <p className="text-muted-foreground text-[13px] italic">
                                  This message was deleted.
                                </p>
                              ) : null}
                              {message.reactions?.length ? (
                                <div
                                  aria-label="Message reactions"
                                  className="mt-2 flex flex-wrap gap-1"
                                >
                                  {message.reactions.map((reaction) => (
                                    <button
                                      aria-label={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}`}
                                      aria-pressed={reaction.reacted}
                                      className={`chip-3d inline-flex min-h-8 items-center gap-1.5 rounded-full! px-2.5 text-xs ${reaction.reacted ? "text-[var(--community-accent-resolved)] ring-1 ring-[var(--community-accent-resolved)]" : "text-muted-foreground"}`}
                                      disabled={!canSend}
                                      key={reaction.emoji}
                                      onClick={() =>
                                        void reactToMessage(
                                          message,
                                          reaction.emoji
                                        )
                                      }
                                      type="button"
                                    >
                                      <span className="text-base">
                                        {reaction.emoji}
                                      </span>
                                      <span>{reaction.count}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {editingMessageId === message.id ? (
                                <div className="mt-2 grid gap-2">
                                  <Textarea
                                    aria-label="Edit message"
                                    className="min-h-16 text-sm"
                                    maxLength={4000}
                                    onChange={(event) =>
                                      setEditContent(event.target.value)
                                    }
                                    value={editContent}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      className="h-7 rounded-full px-3 text-xs"
                                      disabled={
                                        savingMessage || !editContent.trim()
                                      }
                                      onClick={() =>
                                        void saveMessageEdit(message)
                                      }
                                      variant="premium"
                                    >
                                      {savingMessage ? "Saving…" : "Save edit"}
                                    </Button>
                                    <Button
                                      className="h-7 rounded-full px-3 text-xs"
                                      onClick={() => {
                                        setEditingMessageId(null);
                                        setEditContent("");
                                      }}
                                      variant="ghost"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              {confirmDeleteId === message.id ? (
                                <div
                                  className="surface-3d mt-2 flex flex-wrap items-center gap-2 rounded-xl! p-2"
                                  role="alert"
                                >
                                  <span className="text-foreground text-xs">
                                    Delete this message? A placeholder will
                                    remain.
                                  </span>
                                  <Button
                                    className="text-destructive h-8 rounded-full px-3 text-xs"
                                    disabled={savingMessage}
                                    onClick={() => void removeMessage(message)}
                                    variant="ghost"
                                  >
                                    Delete
                                  </Button>
                                  <Button
                                    className="h-8 rounded-full px-3 text-xs"
                                    onClick={() => setConfirmDeleteId(null)}
                                    variant="ghost"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : null}
                              {!threadId && linkedThread ? (
                                <Link
                                  className="hover:bg-muted/60 mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[var(--community-accent-resolved)]"
                                  href={`/a/${slug}/chat/${channelId}/threads/${linkedThread.room.id}`}
                                >
                                  <MessageCircle className="size-3.5" />
                                  {linkedThread.room.name} ·{" "}
                                  {linkedThread.room.nextSequence} replies
                                </Link>
                              ) : null}
                            </div>
                          </article>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {!atLatest ? (
                <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2">
                  <Button
                    className="pointer-events-auto h-9 gap-2 rounded-full px-4 shadow-md"
                    onClick={() => void jumpToMessage()}
                    variant="premium"
                  >
                    <ArrowDown className="size-4" />
                    {hasNewActivity
                      ? "New messages · Jump to latest"
                      : "Jump to latest"}
                  </Button>
                </div>
              ) : null}
              {callToChat}
              {canSend ? (
                <form
                  className="border-border/60 mx-3 mb-3 rounded-2xl border bg-[hsl(var(--background))] p-2.5 shadow-sm sm:mx-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  {replyTarget ? (
                    <div className="border-border/60 mb-2 flex items-center gap-2 border-b px-2 pb-2">
                      <Reply className="size-3.5 shrink-0 text-[var(--community-accent-resolved)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">
                          Replying to {displayName(replyTarget.sender)}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {replyTarget.payload?.type === "text"
                            ? replyTarget.payload.content
                            : "Message"}
                        </p>
                      </div>
                      <Button
                        aria-label="Cancel reply"
                        className="size-8 shrink-0 rounded-full"
                        onClick={() => {
                          setReplyTarget(null);
                          setPendingDraft(null);
                        }}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                  <Textarea
                    aria-label={`Message #${channelName}`}
                    className="max-h-40 min-h-11 resize-y border-0 bg-transparent px-2 py-2 text-[13px] shadow-none focus-visible:ring-0"
                    maxLength={4000}
                    disabled={sending}
                    ref={composerRef}
                    onChange={(event) => {
                      setContent(event.target.value);
                      if (pendingDraft) {
                        setPendingDraft(null);
                      }
                      if (sendError) {
                        setSendError(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={
                      threadId
                        ? `Message ${channelName}`
                        : `Message #${channelName}`
                    }
                    value={content}
                  />
                  <div className="border-border/50 flex items-center justify-between border-t px-1 pt-2">
                    <span className="text-muted-foreground text-[10px]">
                      Enter to send · Shift + Enter for a new line
                    </span>
                    <Button
                      aria-label="Send message"
                      className="h-8 gap-2 rounded-full px-3.5"
                      disabled={!content.trim() || sending}
                      size="sm"
                      type="submit"
                      variant="premium"
                    >
                      <span>{sending ? "Sending…" : "Send"}</span>
                      <Send className="size-3.5" />
                    </Button>
                  </div>
                  {sendError ? (
                    <div className="bg-destructive/5 mt-2 flex items-center justify-between rounded-lg px-2.5 py-2 text-xs">
                      <span className="text-destructive">{sendError}</span>
                      <Button
                        className="h-7 px-2 text-xs"
                        disabled={sending}
                        onClick={async () => {
                          await send();
                        }}
                        type="button"
                        variant="ghost"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </form>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
