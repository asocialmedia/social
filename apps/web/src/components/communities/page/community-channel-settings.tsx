"use client";

// oxlint-disable react/todo -- Request errors and pending controls require try/catch/finally until the compiler supports that control flow.

import type { CommunityChatRoom } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Switch } from "@asm/ui/shadui/switch";
import { Textarea } from "@asm/ui/shadui/textarea";
import { Settings2 } from "lucide-react";
import { useState } from "react";

interface ChannelSettingsProps {
  canArchive: boolean;
  onUpdated: (channel: CommunityChatRoom) => void;
  room: CommunityChatRoom;
  slug: string;
}

export default function CommunityChannelSettings({
  canArchive,
  onUpdated,
  room,
  slug,
}: ChannelSettingsProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(room.name);
  const [topic, setTopic] = useState(room.topic ?? "");
  const [slowMode, setSlowMode] = useState(room.slowModeSeconds);
  const [position, setPosition] = useState(room.sortOrder);
  const [locked, setLocked] = useState(room.locked);
  const [announcement, setAnnouncement] = useState(
    room.channelType === "ANNOUNCEMENT"
  );
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async (archived = false) => {
    setSaving(true);
    setRequestError(null);
    try {
      const response = await fetch(
        `/api/communities/${slug}/chat/channels/${room.id}`,
        {
          body: JSON.stringify({
            archived,
            channelType: announcement ? "ANNOUNCEMENT" : "TEXT",
            locked,
            name,
            slowModeSeconds: slowMode,
            sortOrder: position,
            topic: topic || null,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      );
      const result = (await response.json()) as {
        channel?: CommunityChatRoom;
        error?: string;
      };
      if (!response.ok || !result.channel) {
        throw new Error(result.error ?? "Couldn't save this channel");
      }
      onUpdated(result.channel);
      setOpen(false);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Couldn't save this channel"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="Channel settings"
          className="min-h-12 w-full justify-start gap-3 rounded-xl px-3"
          onClick={() => {
            setName(room.name);
            setTopic(room.topic ?? "");
            setSlowMode(room.slowModeSeconds);
            setPosition(room.sortOrder);
            setLocked(room.locked);
            setAnnouncement(room.channelType === "ANNOUNCEMENT");
            setRequestError(null);
            setConfirmArchive(false);
          }}
          variant="ghost"
        >
          <Settings2 className="size-4" />
          <span>Channel settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{room.name} settings</DialogTitle>
          <DialogDescription>
            Shape this channel for your community.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await save();
          }}
        >
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor={`${room.id}-name`}
          >
            Channel name
            <Input
              id={`${room.id}-name`}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor={`${room.id}-topic`}
          >
            Topic
            <Textarea
              id={`${room.id}-topic`}
              maxLength={500}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="What happens in this channel?"
              value={topic}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor={`${room.id}-slow-mode`}
            >
              Slow mode
              <select
                id={`${room.id}-slow-mode`}
                className="premium-input w-full px-3 py-2 text-sm"
                onChange={(event) => setSlowMode(Number(event.target.value))}
                value={slowMode}
              >
                {[0, 5, 10, 30, 60, 300, 900, 3600].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds === 0 ? "Off" : `${seconds} seconds`}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor={`${room.id}-position`}
            >
              Channel position
              <Input
                id={`${room.id}-position`}
                min={0}
                max={9999}
                onChange={(event) => setPosition(Number(event.target.value))}
                type="number"
                value={position}
              />
            </label>
          </div>
          <label
            className="surface-3d flex items-center justify-between gap-4 rounded-xl! p-3"
            htmlFor={`${room.id}-announcement`}
          >
            <span>
              <span className="block text-sm font-medium">
                Announcement channel
              </span>
              <span className="text-muted-foreground text-xs">
                Only owners and moderators can post.
              </span>
            </span>
            <Switch
              checked={announcement}
              id={`${room.id}-announcement`}
              onCheckedChange={setAnnouncement}
            />
          </label>
          <label
            className="surface-3d flex items-center justify-between gap-4 rounded-xl! p-3"
            htmlFor={`${room.id}-locked`}
          >
            <span>
              <span className="block text-sm font-medium">Lock channel</span>
              <span className="text-muted-foreground text-xs">
                Keep history available and pause new messages.
              </span>
            </span>
            <Switch
              checked={locked}
              id={`${room.id}-locked`}
              onCheckedChange={setLocked}
            />
          </label>
          {requestError ? (
            <p className="text-destructive text-sm" role="alert">
              {requestError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={saving || !name.trim()}
              type="submit"
              variant="premium"
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
          <div className="border-border/60 border-t pt-3">
            <Button
              className="text-destructive"
              disabled={!canArchive || saving}
              onClick={async () => {
                if (confirmArchive) {
                  await save(true);
                } else {
                  setConfirmArchive(true);
                }
              }}
              type="button"
              variant="ghost"
            >
              {confirmArchive ? "Confirm archive channel" : "Archive channel"}
            </Button>
            <p className="text-muted-foreground mt-1 text-xs">
              {canArchive
                ? "Archived channels keep their history and stop accepting messages."
                : "Keep at least one channel available for the community."}
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
