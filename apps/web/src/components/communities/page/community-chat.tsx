"use client";

// oxlint-disable react/todo -- The current React Compiler lint cannot lower the async try/catch/finally blocks used for visible request and retry states.
// oxlint-disable no-nested-ternary, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, no-void -- Timeline states use compact JSX branches and event handlers intentionally detach requests that manage their own errors.

import type {
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatMemberOption,
  CommunityChatPermissions,
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
import { Avatar, AvatarFallback, AvatarImage } from "@asm/ui/shadui/avatar";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Textarea } from "@asm/ui/shadui/textarea";
import {
  ArrowDown,
  Hash,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
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
} from "react";
import type { CSSProperties } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";

import CommunityAvatar from "../card/community-avatar";
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

export default function CommunityChat({
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
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atLatestRef = useRef(true);
  const latestSequence = useRef("0");
  const latestChangeSequence = useRef("0");
  const lastReadSequence = useRef("0");
  const previousHeight = useRef<number | null>(null);
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
  const [atLatest, setAtLatest] = useState(true);
  const [hasNewActivity, setHasNewActivity] = useState(false);
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [savingMessage, setSavingMessage] = useState(false);
  const [followingThread, setFollowingThread] = useState(false);
  const [savingThreadPreference, setSavingThreadPreference] = useState(false);

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
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of newMessages) {
        byId.set(message.id, message);
      }
      const next = [...byId.values()].toSorted((left, right) => {
        const leftSequence = BigInt(left.sequence);
        const rightSequence = BigInt(right.sequence);
        if (leftSequence < rightSequence) {
          return -1;
        }
        if (leftSequence > rightSequence) {
          return 1;
        }
        return 0;
      });
      latestSequence.current = next.at(-1)?.sequence ?? latestSequence.current;
      latestChangeSequence.current =
        next.at(-1)?.changeSequence ?? latestChangeSequence.current;
      if (!atLatestRef.current) {
        setHasNewActivity(true);
      }
      return next.slice(-800);
    });
  }, []);

  const fetchLatest = useCallback(async () => {
    const search =
      latestSequence.current === "0"
        ? ""
        : `?after=${encodeURIComponent(latestSequence.current)}&limit=100`;
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
  }, [appendMessages, roomUrl]);

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
        const [channelsResponse, messagesResponse, threadsResponse] =
          await Promise.all([
            fetch(channelsUrl, { cache: "no-store" }),
            fetch(`${roomUrl}/messages?limit=50`, { cache: "no-store" }),
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
        latestSequence.current = page.messages.at(-1)?.sequence ?? "0";
        latestChangeSequence.current =
          page.messages.at(-1)?.changeSequence ?? "0";
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
      let change: { kind?: string; messageId?: string } | null = null;
      try {
        change = JSON.parse(streamEvent.data) as {
          kind?: string;
          messageId?: string;
        };
      } catch {
        change = null;
      }
      if (change?.kind === "thread.created") {
        try {
          await refreshThreads();
        } catch {
          setSendError("Couldn't refresh the community's discussions.");
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
          setSendError("Couldn't refresh community rooms.");
        }
      }
      if (change?.kind === "thread.updated") {
        try {
          await refreshThreads();
        } catch {
          setSendError("Couldn't refresh the community's discussions.");
        }
      }
      try {
        const messageId = change?.messageId;
        const isMessageMutation =
          change !== null &&
          (change.kind === "message.edited" ||
            change.kind === "message.deleted") &&
          typeof messageId === "string";
        const refreshRequest = isMessageMutation
          ? fetchChangedMessage(messageId)
          : fetchLatest();
        await refreshRequest;
      } catch {
        setSendError("Live updates paused. Reconnect to refresh the channel.");
      }
    };
    source.addEventListener("change", refresh);
    source.addEventListener("reset", refresh);
    source.addEventListener("access-revoked", () => {
      source.close();
      setMessages([]);
      setLoadError("Your access to this conversation changed.");
    });
    source.addEventListener("error", () => {
      setHasNewActivity(true);
    });
    return () => source.close();
  }, [
    channelsUrl,
    fetchChangedMessage,
    fetchLatest,
    loading,
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
    if (previousHeight.current !== null) {
      transcript.scrollTop += transcript.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (atLatest) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [atLatest, messages]);
  // oxlint-enable react/exhaustive-effect-dependencies

  const latestVisibleSequence = messages.at(-1)?.sequence ?? null;
  useEffect(() => {
    if (!permissions?.isMember || !atLatest || !latestVisibleSequence) {
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
  }, [atLatest, latestVisibleSequence, permissions?.isMember, roomUrl]);

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
      setSendError(
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
      const { current: transcript } = transcriptRef;
      if (transcript && page.messages.length > 0) {
        previousHeight.current = transcript.scrollHeight;
      }
      setMessages((current) => {
        const byId = new Map(
          page.messages.map((message) => [message.id, message])
        );
        for (const message of current) {
          byId.set(message.id, message);
        }
        const next = [...byId.values()].toSorted((left, right) => {
          const leftSequence = BigInt(left.sequence);
          const rightSequence = BigInt(right.sequence);
          if (leftSequence < rightSequence) {
            return -1;
          }
          if (leftSequence > rightSequence) {
            return 1;
          }
          return 0;
        });
        return next.slice(-800);
      });
    } catch (error) {
      setLoadError(
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
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <
      64;
    atLatestRef.current = nearLatest;
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
      appendMessages([result.message]);
      setContent("");
      setPendingDraft(null);
      setAtLatest(true);
      atLatestRef.current = true;
      setHasNewActivity(false);
      requestAnimationFrame(() => {
        if (transcriptRef.current) {
          transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
      });
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
      setSendError(
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
      setSendError(
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
      setSendError(null);
      try {
        const response = await fetch(threadsUrl, {
          body: JSON.stringify({
            clientId: crypto.randomUUID(),
            name: "Discussion",
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
          throw new Error(data?.error ?? "Couldn't start a discussion");
        }
        router.push(`/a/${slug}/chat/${channelId}/threads/${data.thread.id}`);
      } catch (error) {
        setSendError(
          error instanceof Error ? error.message : "Couldn't start a discussion"
        );
      } finally {
        setCreatingThread(false);
      }
    },
    [channelId, creatingThread, router, slug, threadsUrl]
  );

  const createPrivateThread = useCallback(async () => {
    if (
      creatingThread ||
      !privateThreadName.trim() ||
      !privateThreadStarter.trim() ||
      selectedMemberIds.length === 0
    ) {
      return;
    }
    setCreatingThread(true);
    setSendError(null);
    try {
      const response = await fetch(threadsUrl, {
        body: JSON.stringify({
          clientId: crypto.randomUUID(),
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
      setPrivateThreadName("");
      setPrivateThreadStarter("");
      setMemberSearch("");
      setMemberOptions([]);
      setMemberCursor(null);
      setSelectedMemberIds([]);
      router.push(`/a/${slug}/chat/${channelId}/threads/${data.thread.id}`);
    } catch (error) {
      setSendError(
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
      setSendError(null);
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
        setSendError(
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
      setSendError(null);
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
        setSendError(
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

  const sortedMessages = messages;
  const channelName = room?.name ?? "conversation";
  const canManage = permissions?.canManage ?? false;
  const canSend = permissions?.canSend ?? false;

  const channelList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
            Community rooms
          </p>
          <p className="text-foreground mt-1 text-sm font-semibold">
            A place to gather
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
                {type === "TEXT" ? "Open chat" : "Staff updates"}
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
            {creatingChannel ? "Creating…" : "Create room"}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {channels.map((channel) => (
          <button
            aria-current={channel.id === channelId ? "page" : undefined}
            className={`group relative mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${channel.id === channelId ? "text-foreground bg-[color-mix(in_srgb,var(--community-accent)_12%,hsl(var(--background)))]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
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
              <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--community-accent)]" />
            ) : null}
          </button>
        ))}
        <div className="border-border/50 mt-4 border-t px-1 pt-3">
          <p className="text-muted-foreground px-2 pb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Community threads
          </p>
          {threads.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 text-xs leading-relaxed">
              Discussions started in this room will show up here.
            </p>
          ) : (
            threads.map((thread) => (
              <button
                aria-current={threadId === thread.room.id ? "page" : undefined}
                className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${threadId === thread.room.id ? "text-foreground bg-[color-mix(in_srgb,var(--community-accent)_12%,hsl(var(--background)))]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
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
          Conversations belong to the community. Follow the rooms that matter to
          you.
        </p>
      </div>
    </div>
  );

  const callToChat = canSend ? null : (
    <div className="border-border/60 bg-muted/35 mx-4 mb-3 rounded-2xl border px-4 py-3 text-sm">
      {membership ? (
        membership.status === "PENDING" ? (
          <p className="text-muted-foreground">
            Your membership request is waiting for approval. You can read along
            while you wait.
          </p>
        ) : room?.archived || room?.locked ? (
          <p className="text-muted-foreground">
            This room is read-only right now.
          </p>
        ) : room?.channelType === "ANNOUNCEMENT" ? (
          <p className="text-muted-foreground">
            Only community staff can post updates here.
          </p>
        ) : (
          <p className="text-muted-foreground">
            You can read this room, but can’t send messages right now.
          </p>
        )
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
      className="relative flex min-h-0 flex-1 flex-col"
      style={communityAccentStyle(accentColor) as CSSProperties}
    >
      <div className="border-border/60 flex min-h-0 flex-1 overflow-hidden border-b">
        <aside className="surface-3d border-border/60 hidden w-60 shrink-0 flex-col border-r bg-[hsl(var(--background-alt))] md:flex">
          {channelList}
        </aside>

        {mobileChannelsOpen ? (
          <>
            <button
              aria-label="Close rooms menu"
              className="absolute inset-0 z-20 bg-black/35 md:hidden"
              onClick={() => setMobileChannelsOpen(false)}
              type="button"
            />
            <aside className="panel-3d border-border/70 absolute inset-y-0 left-0 z-30 flex w-[min(18rem,86vw)] flex-col border-r bg-[hsl(var(--background-alt))] md:hidden">
              {channelList}
            </aside>
          </>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-border/60 flex min-h-14 items-center gap-3 border-b px-3 sm:px-5">
            <Button
              aria-label="Browse community rooms"
              className="icon-btn-3d size-9 rounded-full md:hidden"
              onClick={() => setMobileChannelsOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu className="size-4" />
            </Button>
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--community-accent)_13%,hsl(var(--background)))] text-[var(--community-accent)]">
              {room?.kind === "THREAD" ? (
                <MessageCircle className="size-[18px]" />
              ) : (
                <Hash className="size-[18px]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-foreground truncate text-sm font-bold">
                {channelName}
              </h2>
              <p className="text-muted-foreground truncate text-[11px]">
                {room?.kind === "THREAD"
                  ? `${room.visibility === "PRIVATE" ? "Private thread" : "Thread"} in #${channels.find((channel) => channel.id === channelId)?.name ?? "community"}`
                  : room?.topic || `A conversation in ${communityName}`}
              </p>
            </div>
            {room?.channelType === "ANNOUNCEMENT" ? (
              <span className="chip-3d text-muted-foreground hidden rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase sm:inline-flex">
                Staff updates
              </span>
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
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setPrivateThreadOpen((open) => !open)}
                variant="premium"
              >
                <LockKeyhole className="mr-1.5 size-3.5" />
                Private thread
              </Button>
            ) : threadId ? (
              <Button
                asChild
                className="h-8 rounded-full px-3 text-xs"
                variant="ghost"
              >
                <Link href={`/a/${slug}/chat/${channelId}`}>Back to room</Link>
              </Button>
            ) : null}
          </header>

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
                      !privateThreadStarter.trim() ||
                      selectedMemberIds.length === 0
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
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-5"
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
                      Opening the community room…
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
                        Room history
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
                            className={`group hover:bg-muted/35 flex gap-3 rounded-xl px-2 py-1.5 transition-colors ${isGrouped ? "pt-0.5" : "mt-2"}`}
                          >
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
                                <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-foreground text-[13px] font-bold">
                                    {displayName(message.sender)}
                                  </span>
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
                              {message.payload?.type === "text" ? (
                                <p className="text-foreground/90 text-[13px] leading-[1.55] break-words whitespace-pre-wrap">
                                  {message.payload.content}
                                </p>
                              ) : message.deletedAt ? (
                                <p className="text-muted-foreground text-[13px] italic">
                                  This message was removed by community staff.
                                </p>
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
                              {!message.deletedAt &&
                              (user?.id === message.senderId || canManage) ? (
                                <div className="mt-1 flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                                  {user?.id === message.senderId ? (
                                    <Button
                                      className="h-6 rounded-full px-2 text-[10px]"
                                      onClick={() => {
                                        setEditingMessageId(message.id);
                                        setEditContent(
                                          message.payload?.type === "text"
                                            ? message.payload.content
                                            : ""
                                        );
                                      }}
                                      variant="ghost"
                                    >
                                      Edit
                                    </Button>
                                  ) : null}
                                  {confirmDeleteId === message.id ? (
                                    <>
                                      <span className="text-destructive px-1 text-[10px]">
                                        Remove this message?
                                      </span>
                                      <Button
                                        className="h-6 rounded-full px-2 text-[10px]"
                                        disabled={savingMessage}
                                        onClick={() =>
                                          void removeMessage(message)
                                        }
                                        variant="ghost"
                                      >
                                        Remove
                                      </Button>
                                      <Button
                                        className="h-6 rounded-full px-2 text-[10px]"
                                        onClick={() => setConfirmDeleteId(null)}
                                        variant="ghost"
                                      >
                                        Keep
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      className="h-6 rounded-full px-2 text-[10px]"
                                      onClick={() =>
                                        setConfirmDeleteId(message.id)
                                      }
                                      variant="ghost"
                                    >
                                      Remove
                                    </Button>
                                  )}
                                </div>
                              ) : null}
                              {!threadId ? (
                                <div className="mt-1.5 flex items-center gap-2">
                                  {linkedThread ? (
                                    <Link
                                      className="hover:bg-muted/60 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-[var(--community-accent)]"
                                      href={`/a/${slug}/chat/${channelId}/threads/${linkedThread.room.id}`}
                                    >
                                      <MessageCircle className="size-3.5" />
                                      {linkedThread.room.nextSequence} replies
                                    </Link>
                                  ) : canSend ? (
                                    <Button
                                      className="h-7 rounded-full px-2.5 text-[11px]"
                                      disabled={creatingThread}
                                      onClick={() =>
                                        void createPublicThread(message.id)
                                      }
                                      variant="ghost"
                                    >
                                      <MessageCircle className="mr-1 size-3.5" />
                                      Start a discussion
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </article>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {!atLatest && hasNewActivity ? (
                <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2">
                  <Button
                    className="pointer-events-auto h-9 gap-2 rounded-full px-4 shadow-md"
                    onClick={() => {
                      if (transcriptRef.current) {
                        transcriptRef.current.scrollTop =
                          transcriptRef.current.scrollHeight;
                      }
                      setHasNewActivity(false);
                    }}
                    variant="premium"
                  >
                    <ArrowDown className="size-4" />
                    New activity
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
                  <Textarea
                    aria-label={`Message #${channelName}`}
                    className="max-h-40 min-h-11 resize-y border-0 bg-transparent px-2 py-2 text-[13px] shadow-none focus-visible:ring-0"
                    maxLength={4000}
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
                    placeholder={`Write to #${channelName}`}
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
