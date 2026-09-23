"use client";

import { Switch } from "@asm/ui/shadui/switch";
import { BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  SETTINGS_SUBCARD_CLASS,
  SettingsCard,
  SettingsCardHeading,
  SettingsStatusChip,
} from "@/components/settings/settings-section-card";
import {
  disableWebPush,
  enableWebPush,
  hasActivePushSubscription,
  pushSupported,
} from "@/lib/push/client";
import type { PushSupport } from "@/lib/push/client";
import { cn } from "@/lib/utils";

type ToggleState = "loading" | "off" | "on" | "working";

function chipLabel(state: ToggleState, on: boolean): string {
  if (state === "loading") {
    return "Checking";
  }
  if (state === "working") {
    return "Saving";
  }
  return on ? "On" : "Off";
}

// Notification settings card: a single toggle for browser push on this device.
// The state is derived from the browser's own subscription (the source of
// truth), so a subscription removed outside the app shows correctly.
export default function PushSettingsCard() {
  // Capability is a synchronous, side-effect-free probe, so it is derived each
  // render rather than held in state (which would force a setState before the
  // first await and trip the set-state-in-effect lint).
  const support = pushSupported();
  const [state, setState] = useState<ToggleState>("loading");

  const refresh = useCallback(async () => {
    // Await first: the subscription read is async, so no state is touched
    // synchronously inside the effect that calls this.
    const active = await hasActivePushSubscription();
    setState(active ? "on" : "off");
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async read of the browser's subscription on mount; the value cannot be derived during render
    void refresh();
  }, [refresh]);

  const handleToggle = useCallback(async () => {
    if (state === "loading" || state === "working") {
      return;
    }
    const next = state !== "on";
    setState("working");
    const ok = next ? await enableWebPush() : await disableWebPush();
    // Re-read the browser truth rather than assuming the intent succeeded:
    // permission can be denied at the OS dialog after a successful call.
    if (ok) {
      await refresh();
    } else {
      setState((await hasActivePushSubscription()) ? "on" : "off");
    }
  }, [refresh, state]);

  const on = state === "on";
  const disabled = state === "loading" || state === "working";
  const description = describe(support, state);

  return (
    <SettingsCard id="settings-push">
      <div className="flex flex-col gap-4">
        <SettingsCardHeading
          description="Alerts for follows, amplifies, eddies and mentions"
          icon={BellRing}
          title="Notifications"
        />
        <div className={cn(SETTINGS_SUBCARD_CLASS, "p-4")}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Push notifications</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {description}
              </p>
            </div>
            <Switch
              aria-label="Toggle push notifications"
              checked={on}
              disabled={disabled || !support.supported}
              onCheckedChange={handleToggle}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <SettingsStatusChip on={on}>
              {chipLabel(state, on)}
            </SettingsStatusChip>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

function describe(support: PushSupport, state: ToggleState): string {
  if (!support.supported) {
    switch (support.reason) {
      case "denied": {
        return "Blocked in your browser settings. Allow notifications for this site to turn these on.";
      }
      case "insecure": {
        return "Push needs a secure (https) connection.";
      }
      default: {
        return "This browser does not support push notifications.";
      }
    }
  }
  if (state === "on") {
    return "On for this browser. Turn off to stop them.";
  }
  return "Send a notification to this browser when something happens.";
}
