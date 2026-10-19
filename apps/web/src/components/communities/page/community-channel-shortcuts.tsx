"use client";

import type { CommunityChatRoom } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";

export default function CommunityChannelShortcuts({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: () => void;
}) {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  return (
    <ChannelShortcuts
      key={`${user?.id ?? "guest"}:${slug}:${attempt}`}
      slug={slug}
      onNavigate={onNavigate}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ChannelShortcuts({
  slug,
  onNavigate,
  onRetry,
}: {
  slug: string;
  onNavigate: () => void;
  onRetry: () => void;
}) {
  const [channels, setChannels] = useState<CommunityChatRoom[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/communities/${slug}/chat/channels`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setStatus("error");
          }
          return;
        }
        const page = (await response.json()) as {
          channels: CommunityChatRoom[];
        };
        if (!controller.signal.aborted) {
          setChannels(page.channels);
          setStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus("error");
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [slug]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <h2 className="text-muted-foreground mb-3 px-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
        Channels
      </h2>
      {status === "loading" ? (
        <output aria-label="Loading channels" className="block space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </output>
      ) : null}
      {status === "error" ? (
        <div className="space-y-2 px-2">
          <p className="text-muted-foreground text-sm">
            Couldn’t load channels.
          </p>
          <Button
            className="min-h-11"
            variant="premium-neutral"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {status === "ready" && channels.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">
          No channels are available.
        </p>
      ) : null}
      {channels.map((channel) => (
        <Link
          key={channel.id}
          href={`/a/${slug}/chat/${channel.id}`}
          onClick={onNavigate}
          className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm"
        >
          <MessageCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {channel.channelType === "ANNOUNCEMENT" ? (
            <span className="text-[10px] uppercase">Staff</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
