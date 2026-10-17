"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import {
  Check,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Unlink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaBluesky } from "react-icons/fa6";

import { LoadingButton } from "@/components/auth/fields/loading-button";
import { SettingsStatusChip } from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface BlueskyConnectCardProps {
  blueskyHandle?: string | null;
  hasVerifiedEmail: boolean;
}

export function BlueskyConnectCard({
  blueskyHandle,
  hasVerifiedEmail,
}: BlueskyConnectCardProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = Boolean(blueskyHandle);
  const cleanHandle = (blueskyHandle ?? "").replace(/^@/, "");

  async function handleConnect(event: React.FormEvent) {
    event.preventDefault();
    if (!handle.trim()) {
      toast({
        description: "Please enter your Bluesky handle.",
        title: "Missing Handle",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    let errorMessage: string | null = null;
    let connectedHandle: string | null = null;

    try {
      const response = await fetch("/api/protocols/bluesky/link", {
        body: JSON.stringify({
          appPassword: appPassword.trim() || undefined,
          handle: handle.trim(),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const data = await response.json();
      if (response.ok) {
        connectedHandle = data.handle;
      } else {
        errorMessage = data.error || "Failed to link Bluesky account.";
      }
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Could not link your Bluesky account.";
    }

    setIsConnecting(false);

    if (errorMessage) {
      toast({
        description: errorMessage,
        title: "Connection Failed",
        variant: "destructive",
      });
      return;
    }

    toast({
      description: `Connected to Bluesky as @${connectedHandle}!`,
      title: "Bluesky Linked",
    });
    setIsDialogOpen(false);
    setHandle("");
    setAppPassword("");
    router.refresh();
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    let errorMessage: string | null = null;

    try {
      const response = await fetch("/api/protocols/bluesky/unlink", {
        method: "POST",
      });

      if (response.ok) {
        // Successfully unlinked
      } else {
        const data = await response.json().catch(() => ({}));
        errorMessage = data.error || "Failed to disconnect Bluesky account.";
      }
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Could not disconnect Bluesky account.";
    }

    setIsDisconnecting(false);

    if (errorMessage) {
      toast({
        description: errorMessage,
        title: "Disconnection Failed",
        variant: "destructive",
      });
      return;
    }

    toast({
      description: "Your Bluesky account has been unlinked.",
      title: "Disconnected",
    });
    router.refresh();
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-sky-600/5 to-transparent p-5 shadow-sm sm:p-6">
        {/* Subtle decorative background glow */}
        <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-sky-500/10 blur-2xl" />

        <div className="flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#0085ff]/15 text-[#0085ff] shadow-inner">
                <FaBluesky className="size-6 text-[#0085ff]" />
              </div>
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                  Bluesky Connection
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400">
                      <Sparkles className="size-3" /> Linked
                    </span>
                  )}
                </h3>
                <p className="text-muted-foreground text-xs sm:text-sm">
                  Connect your AT Protocol account to interact across federated
                  threads and post seamlessly.
                </p>
              </div>
            </div>

            <SettingsStatusChip on={isConnected}>
              {isConnected ? "Active" : "Unlinked"}
            </SettingsStatusChip>
          </div>

          {/* Email Verification Requirement Notice */}
          {!hasVerifiedEmail && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-xs sm:text-sm">
                You must verify your email address on asocialmedia before
                connecting an external federated account.
              </p>
            </div>
          )}

          {/* Connected State Info or Connect Action */}
          {isConnected ? (
            <div className="border-border/40 bg-background/50 flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Linked Bluesky Handle
                </span>
                <span className="font-mono text-sm font-semibold text-sky-400 sm:text-base">
                  @{cleanHandle}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className={cn(
                    "border-border/50 bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
                  )}
                  href={`https://bsky.app/profile/${cleanHandle}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  View Profile
                </a>
                <LoadingButton
                  className="h-9 px-3 text-xs"
                  disabled={isDisconnecting}
                  loading={isDisconnecting}
                  onClick={handleDisconnect}
                  variant="destructive"
                >
                  <Unlink className="mr-1.5 size-3.5" />
                  Disconnect
                </LoadingButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">
                Linking your account allows you to cross-post and engage
                directly with the AT Protocol federated firehose.
              </p>
              <Button
                className="pill-3d-hover bg-sky-500 text-white hover:bg-sky-600 sm:self-end"
                disabled={!hasVerifiedEmail}
                onClick={() => setIsDialogOpen(true)}
                size="sm"
              >
                <FaBluesky className="mr-2 size-4" />
                Connect Bluesky
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Connect Modal */}
      <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FaBluesky className="size-5 text-[#0085ff]" />
              Connect your Bluesky Account
            </DialogTitle>
            <DialogDescription>
              Enter your Bluesky handle and an optional App Password to link
              your identity and enable cross-posting actions.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4 py-2" onSubmit={handleConnect}>
            <div className="space-y-2">
              <label
                className="text-foreground text-xs font-medium"
                htmlFor="bsky-handle"
              >
                Bluesky Handle
              </label>
              <div className="relative">
                <span className="text-muted-foreground absolute inset-y-0 left-3 flex items-center text-sm font-semibold">
                  @
                </span>
                <Input
                  className="pl-7 font-mono text-sm"
                  id="bsky-handle"
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="alice.bsky.social"
                  required
                  value={handle}
                />
              </div>
              <p className="text-muted-foreground text-[11px]">
                Your handle on Bluesky or your custom domain handle.
              </p>
            </div>

            <div className="space-y-2">
              <label
                className="text-foreground text-xs font-medium"
                htmlFor="bsky-password"
              >
                App Password (Optional)
              </label>
              <Input
                autoComplete="off"
                className="font-mono text-sm"
                id="bsky-password"
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                type="password"
                value={appPassword}
              />
              <p className="text-muted-foreground text-[11px]">
                Recommended for publishing likes, replies, and posts from ASM.
                Generate in Bluesky Settings &gt; App Passwords. Never enter
                your primary password!
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                disabled={isConnecting}
                onClick={() => setIsDialogOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <LoadingButton
                className="pill-3d-hover bg-sky-500 text-white hover:bg-sky-600"
                disabled={isConnecting || !handle.trim()}
                loading={isConnecting}
                type="submit"
              >
                <Check className="mr-1.5 size-4" />
                Connect Account
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
