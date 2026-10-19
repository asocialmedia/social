"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useSession } from "@/lib/auth/session-context";

export function DiscoverySafetyControl() {
  const { user } = useSession();
  const network = useNetworkSettings();
  const label =
    user && network.ready && network.settings.preferences.showExplicitContent
      ? "18+ enabled"
      : "18+ hidden";
  return (
    <Link
      className="chip-3d text-muted-foreground flex shrink-0 items-center gap-1.5 rounded-full! px-2.5 py-1.5 text-xs font-medium"
      href={user ? "/settings?tab=network&section=moderation" : "/login"}
      aria-label={`${label}. ${user ? "Manage Network content settings" : "Sign in to change content settings"}`}
    >
      <ShieldCheck aria-hidden className="size-3.5" />
      <span>{label}</span>
    </Link>
  );
}
