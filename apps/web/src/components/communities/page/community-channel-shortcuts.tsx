"use client";

import type { CommunityChatRoom } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";

import { communityNavigationRowClassName } from "./community-workspace-navigation";

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
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <h2 className="text-muted-foreground flex min-h-12 items-center gap-2 px-3 text-xs font-semibold">
        Channels{" "}
        {status === "ready" ? (
          <span className="font-normal tabular-nums">{channels.length}</span>
        ) : null}
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
          onNavigate={onNavigate}
          className={`${communityNavigationRowClassName} text-foreground/80 hover:bg-muted/60 hover:text-foreground`}
        >
          <MessageCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {channel.channelType === "ANNOUNCEMENT" ? (
            <span className="text-muted-foreground text-xs font-medium">
              Staff
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
