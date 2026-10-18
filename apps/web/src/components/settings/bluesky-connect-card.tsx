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
import { useEffect, useState } from "react";
import { FaBluesky } from "react-icons/fa6";

import { LoadingButton } from "@/components/auth/fields/loading-button";
import { ExternalFollowingList } from "@/components/protocols/external-following-list";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface BlueskyConnectCardProps {
  blueskyHandle?: string | null;
  oauthConnected?: boolean;
  hasVerifiedEmail: boolean;
}

export function BlueskyConnectCard({
  blueskyHandle,
  hasVerifiedEmail,
  oauthConnected = false,
}: BlueskyConnectCardProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [handle, setHandle] = useState(blueskyHandle ?? "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = Boolean(blueskyHandle);
  const cleanHandle = (blueskyHandle ?? "").replace(/^@/, "");

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("bluesky");
    if (!result) {
      return;
    }
    toast({
      description:
        result === "connected"
          ? "Your account is authorized securely."
          : "Authorization was cancelled or expired. Please try again.",
      title:
        result === "connected"
          ? "Bluesky connected"
          : "Bluesky connection failed",
      variant: result === "connected" ? "default" : "destructive",
    });
    url.searchParams.delete("bluesky");
    window.history.replaceState(null, "", url);
  }, [toast]);

  let connectionStatus = "Unlinked";
  if (isConnected) {
    connectionStatus = oauthConnected ? "Active" : "Reconnect needed";
  }

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
    let authorizationUrl: string | null = null;

    try {
      const response = await fetch("/api/protocols/bluesky/link", {
        body: JSON.stringify({
          handle: handle.trim(),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const data = await response.json();
      if (response.ok) {
        authorizationUrl = data.url;
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

    if (authorizationUrl) {
      window.location.assign(authorizationUrl);
    }
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
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl! p-5 text-white sm:p-6",
          "bg-linear-to-b from-[#159dff] via-[#0980fa] to-[#0866df]",
          "border-2 border-white/80 dark:border-white/60",
          "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.45),inset_0_2px_4px_rgba(255,255,255,0.55),0_4px_20px_-2px_rgba(8,102,223,0.35)]"
        )}
        id="settings-bluesky-connection"
      >
        <div className="flex flex-col gap-5">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/50 bg-white/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)] backdrop-blur-xs">
                <FaBluesky className="size-6 text-white drop-shadow-xs" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white sm:text-lg">
                    Bluesky Connection
                  </h3>
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">
                      <Sparkles className="size-3 text-white" /> Linked
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/85 sm:text-sm">
                  Connect your AT Protocol account to interact across federated
                  threads and post seamlessly.
                </p>
              </div>
            </div>

            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-xs",
                isConnected
                  ? "border border-white/60 bg-white/25 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
                  : "border border-white/30 bg-white/10 text-white/80"
              )}
            >
              {connectionStatus}
            </span>
          </div>

          {/* Email Verification Requirement Notice */}
          {!hasVerifiedEmail && (
            <div className="flex items-start gap-2.5 rounded-xl border border-white/30 bg-black/15 p-3 text-white backdrop-blur-xs">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <p className="text-xs text-white/95 sm:text-sm">
                You must verify your email address on asocialmedia before
                connecting an external federated account.
              </p>
            </div>
          )}

          {/* Connected State Info or Connect Action (Directly in card, no box-in-box) */}
          {isConnected ? (
            <div className="flex flex-col gap-4 border-t border-white/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-semibold tracking-wider text-white/75 uppercase">
                  Linked Bluesky Handle
                </span>
                <span className="font-mono text-base font-bold text-white sm:text-lg">
                  @{cleanHandle}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={!hasVerifiedEmail}
                  onClick={() => setIsDialogOpen(true)}
                  type="button"
                >
                  Reconnect securely
                </Button>
                <a
                  className="btn-3d-white inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold text-[#0866df] transition-all"
                  href={`https://bsky.app/profile/${cleanHandle}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  View Profile
                </a>
                <LoadingButton
                  className="btn-3d-danger inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold text-white transition-all"
                  disabled={isDisconnecting}
                  loading={isDisconnecting}
                  onClick={handleDisconnect}
                  type="button"
                >
                  <Unlink className="size-3.5 text-white" />
                  Disconnect
                </LoadingButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 border-t border-white/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-xs leading-relaxed text-white/85 sm:text-sm">
                Linking your account allows you to cross-post, reply to Bluesky
                discussions, and broadcast your interactions directly to the AT
                Protocol firehose.
              </p>
              <Button
                className="btn-3d-white inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold text-[#0866df] transition-all disabled:opacity-50 sm:self-center"
                disabled={!hasVerifiedEmail}
                onClick={() => setIsDialogOpen(true)}
                type="button"
              >
                <FaBluesky className="size-4 text-[#0866df]" />
                Connect Bluesky
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Connect Modal */}
      <ExternalFollowingList />
      <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl! p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg">
              <div className="bluesky-3d-surface flex size-8 shrink-0 items-center justify-center rounded-xl">
                <FaBluesky className="size-4 text-white" />
              </div>
              Connect your Bluesky Account
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs sm:text-sm">
              Enter your Bluesky handle. You’ll continue to your account
              provider to review permissions and authorize asocialmedia.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4 py-2" onSubmit={handleConnect}>
            <div className="space-y-1.5">
              <label
                className="text-foreground text-xs font-semibold"
                htmlFor="bsky-handle"
              >
                Bluesky Handle
              </label>
              <div className="relative">
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold">
                  @
                </span>
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="premium-input h-10 rounded-xl pl-7 font-mono text-sm"
                  id="bsky-handle"
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="alice.bsky.social"
                  required
                  spellCheck="false"
                  value={handle}
                />
              </div>
              <p className="text-muted-foreground text-[11px]">
                Your handle on Bluesky or your custom domain handle.
              </p>
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              Your password stays with your provider. You can revoke access from
              your Bluesky account settings at any time.
            </p>

            <DialogFooter className="gap-2 pt-2 sm:justify-end">
              <Button
                className="btn-3d-gray h-9 rounded-xl px-4 text-sm font-semibold"
                disabled={isConnecting}
                onClick={() => setIsDialogOpen(false)}
                type="button"
              >
                Cancel
              </Button>
              <LoadingButton
                className="btn-3d-bluesky inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white"
                disabled={isConnecting || !handle.trim()}
                loading={isConnecting}
                type="submit"
              >
                <Check className="size-4 text-white" />
                Continue to Bluesky
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
