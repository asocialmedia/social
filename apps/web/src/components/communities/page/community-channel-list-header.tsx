"use client";

import type { CommunityChatRoom } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Plus, X } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useRef, useState } from "react";

type ChannelType = "TEXT" | "ANNOUNCEMENT";

async function requestChannel(
  slug: string,
  body: { channelType: ChannelType; name: string }
): Promise<{ channel: CommunityChatRoom } | { error: string }> {
  const fallback = "Couldn't create channel.";
  try {
    const response = await fetch(`/api/communities/${slug}/chat/channels`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (response.ok) {
      return (await response.json()) as { channel: CommunityChatRoom };
    }
    const problem = (await response.json()) as { error?: string };
    return { error: problem.error ?? fallback };
  } catch {
    return { error: fallback };
  }
}

export default function CommunityChannelListHeader({
  count,
  onCreated,
  slug,
}: {
  count?: number;
  onCreated?: (channel: CommunityChatRoom) => void;
  slug: string;
}) {
  const formId = useId();
  const nameId = useId();
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("TEXT");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!onCreated || !trimmed || pending.current) {
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    const result = await requestChannel(slug, { channelType, name: trimmed });
    pending.current = false;
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setName("");
    setOpen(false);
    onCreated(result.channel);
  };

  return (
    <>
      <div className="flex min-h-12 min-w-0 shrink-0 items-center gap-2 px-4">
        <h2 className="text-muted-foreground flex min-w-0 flex-1 items-baseline gap-1.5 text-xs font-semibold">
          Channels
          {count === undefined ? null : (
            <span className="text-muted-foreground/75 text-[10px] font-medium tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {onCreated ? (
          <button
            aria-controls={open ? formId : undefined}
            aria-expanded={open}
            className="icon-btn-3d text-muted-foreground hover:text-foreground focus-visible:outline-ring flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            disabled={saving}
            onClick={() => setOpen(!open)}
            type="button"
            title={open ? "Cancel channel creation" : "Create chat"}
          >
            {open ? (
              <X aria-hidden="true" className="size-4" />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            <span className="sr-only">
              {open ? "Cancel channel creation" : "Create chat"}
            </span>
          </button>
        ) : null}
      </div>
      {open && onCreated ? (
        <form
          className="surface-3d mx-3 mb-3 shrink-0 rounded-xl p-3"
          id={formId}
          onSubmit={submit}
        >
          <label
            className="text-muted-foreground mb-1.5 block text-xs font-medium"
            htmlFor={nameId}
          >
            Channel name
          </label>
          <Input
            autoFocus
            className="min-h-11"
            disabled={saving}
            id={nameId}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <div className="surface-3d mt-2 flex gap-1 rounded-xl p-1">
            {(["TEXT", "ANNOUNCEMENT"] as const).map((type) => (
              <button
                aria-pressed={channelType === type}
                className="tabs-segment-3d text-muted-foreground hover:text-foreground focus-visible:outline-ring min-h-10 min-w-0 flex-1 rounded-lg px-1 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2"
                data-state={channelType === type ? "active" : "inactive"}
                disabled={saving}
                key={type}
                onClick={() => setChannelType(type)}
                type="button"
              >
                {type === "TEXT" ? "Text" : "Announcement"}
              </button>
            ))}
          </div>
          {error ? (
            <p className="text-destructive mt-2 text-xs" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="mt-3 min-h-11 w-full text-sm"
            disabled={!name.trim() || saving}
            type="submit"
            variant="premium"
          >
            {saving ? "Creating…" : "Create channel"}
          </Button>
        </form>
      ) : null}
    </>
  );
}
