"use client";

import type { NetworkSettings } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";

import { useSession } from "@/app/(main)/session-provider";
import { useToast } from "@/lib/gooey-toast";

import { SettingsPanelSection } from "./settings-panel-section";

export function RecentActivityCard({
  persona,
  profileId,
  revision,
  disabled,
}: {
  persona: NetworkSettings["persona"];
  profileId: string;
  revision?: number;
  disabled: boolean;
}) {
  const { user } = useSession();
  const client = useQueryClient();
  const { toast } = useToast();
  const key = ["network-settings", user?.id ?? "guest"];
  const clear = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/network/preferences", {
        body: JSON.stringify({ profileId, revision }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "Settings changed. Refresh and try again."
            : "Couldn't clear recent activity. Please try again."
        );
      }
      return (await response.json()) as NetworkSettings;
    },
    mutationKey: key,
    onError: (error) => toast({ title: error.message, variant: "destructive" }),
    onSuccess: (settings) => {
      toast({
        description: "This profile can start learning again.",
        title: "Recent activity cleared",
      });
      client.setQueryData(key, settings);
      window.dispatchEvent(new Event("network:settings-changed"));
      const channel =
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel("asm-network-settings");
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel targets the same-origin settings listeners.
      channel?.postMessage("changed");
      channel?.close();
    },
    scope: { id: `network-settings:${user?.id ?? "guest"}` },
  });
  const canClear =
    !disabled && !clear.isPending && revision !== undefined && Boolean(user);
  return (
    <SettingsPanelSection
      count={`${persona.signalCount} interactions`}
      description="Recent browsing and interactions help this profile learn what you enjoy."
      icon={History}
      id="settings-network-activity"
      title="Recent activity"
    >
      <div className="space-y-4 px-3">
        {persona.learnedInterests.length ? (
          <div className="flex flex-wrap gap-2">
            {persona.learnedInterests.map((topic) => (
              <span
                className="chip-3d rounded-full! px-3 py-1 text-sm"
                key={topic}
              >
                {topic}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No recent activity for this profile.
          </p>
        )}
        <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-muted-foreground max-w-md text-xs">
            Clearing starts this profile’s learning again. Your chosen interests
            and connected accounts stay.
          </p>
          <Button
            className="btn-3d-gray h-9 rounded-full px-4 text-sm! font-semibold"
            disabled={!canClear}
            onClick={() => clear.mutate()}
            variant="ghost"
          >
            {clear.isPending ? "Clearing…" : "Clear recent activity"}
          </Button>
        </div>
      </div>
    </SettingsPanelSection>
  );
}
