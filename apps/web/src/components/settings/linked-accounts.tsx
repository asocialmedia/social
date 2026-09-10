import { clientLog } from "@asm/config/debug";
import type { PrivateUserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Link2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import { LoadingButton } from "@/components/auth/loading-button";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

export type SocialProvider = "google" | "reddit";

export interface AccountLinkingReadiness {
  hasPassword: boolean;
  hasVerifiedEmail: boolean;
  linkedProviders: SocialProvider[];
}

interface LinkedAccountsProps {
  accountLinkingReadiness: AccountLinkingReadiness;
  onLink: (provider: string) => void;
  user: PrivateUserData;
}

function providerLabel(provider: SocialProvider): string {
  return provider === "google" ? "Google" : "Reddit";
}

const getStatusText = (isComingSoon: boolean, isConnected?: boolean) => {
  if (isComingSoon) {
    return "Coming Soon";
  }
  return isConnected ? "Connected" : "Not connected";
};

const getButtonText = (isComingSoon: boolean, isConnected?: boolean) => {
  if (isComingSoon) {
    return "Coming Soon";
  }
  return isConnected ? "Disconnect" : "Connect";
};

const CARD_SHADOW_CLASS =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.2)]";

interface AccountCardProps {
  icon: string;
  isLinkingReady: boolean;
  isComingSoon?: boolean;
  isConnected?: boolean;
  isLoading?: boolean;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  provider: SocialProvider;
}

const AccountCard = ({
  provider,
  icon,
  isConnected,
  isLinkingReady,
  isComingSoon = false,
  isLoading = false,
  onConnect,
  onDisconnect,
}: AccountCardProps) => {
  const handleClick = useCallback(() => {
    if (isConnected) {
      onDisconnect(provider);
    } else {
      onConnect(provider);
    }
  }, [isConnected, onDisconnect, onConnect, provider]);

  return (
    <div
      className={cn(
        "border-border/60 flex items-center justify-between gap-4 rounded-xl border bg-[hsl(var(--background))] p-4",
        CARD_SHADOW_CLASS,
        isComingSoon && "opacity-50"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="border-border/60 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-[hsl(var(--background-alt))]">
          <Image
            alt={provider}
            className="size-5"
            height={20}
            src={`/socials/${icon}.svg`}
            width={20}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{providerLabel(provider)}</p>
          <p className="text-muted-foreground truncate text-xs">
            {getStatusText(isComingSoon, isConnected)}
          </p>
        </div>
      </div>
      <LoadingButton
        className={cn(
          "h-8 shrink-0 rounded-full px-3 text-xs",
          isConnected ? "icon-btn-3d" : "follow-btn-3d"
        )}
        disabled={isComingSoon || (!isConnected && !isLinkingReady)}
        loading={isLoading}
        onClick={handleClick}
      >
        {getButtonText(isComingSoon, isConnected)}
      </LoadingButton>
    </div>
  );
};

// React Compiler cannot lower `throw` statements inside component try blocks,
// so the unlink request and its status check live in this module-scoped
// helper.
async function unlinkAccount(provider: string): Promise<void> {
  const response = await fetch(`/api/auth/unlink/${provider}`, {
    method: "POST",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to unlink account");
  }
}

export default function LinkedAccounts({
  accountLinkingReadiness,
  user,
  onLink,
}: LinkedAccountsProps) {
  const { toast } = useToast();
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [providerToConfirm, setProviderToConfirm] =
    useState<SocialProvider | null>(null);

  const isLinkingReady =
    accountLinkingReadiness.hasVerifiedEmail &&
    accountLinkingReadiness.hasPassword;

  const handleLinkRequest = useCallback((provider: string) => {
    if (provider === "google" || provider === "reddit") {
      setProviderToConfirm(provider);
    }
  }, []);

  const handleConfirmedLink = useCallback(() => {
    if (!providerToConfirm) {
      return;
    }
    setLoadingProvider(providerToConfirm);
    onLink(providerToConfirm);
  }, [onLink, providerToConfirm]);

  const handleUnlink = useCallback(
    async (provider: string) => {
      setLoadingProvider(provider);
      try {
        await unlinkAccount(provider);

        toast({
          description: `Your ${provider} account is no longer connected`,
          title: "Account Unlinked",
        });

        window.location.reload();
      } catch (error) {
        clientLog.error("Unlink account error:", error);
        toast({
          description: "Couldn't unlink that account, try again?",
          title: "Couldn't Unlink",
          variant: "destructive",
        });
      }
      // The catch above never rethrows and the try body has no early returns,
      // so resetting here matches the previous `finally` semantics.
      setLoadingProvider(null);
    },
    [toast]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <Link2 className="h-3.5 w-3.5" />
        </div>
        <h3 className="font-medium">Linked Accounts</h3>
      </div>

      {!isLinkingReady && (
        <p className="text-muted-foreground text-sm">
          Verify an email address and add a password before connecting another
          sign-in method.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <AccountCard
          icon="google"
          isConnected={accountLinkingReadiness.linkedProviders.includes(
            "google"
          )}
          isLinkingReady={isLinkingReady}
          isLoading={loadingProvider === "google"}
          onConnect={handleLinkRequest}
          onDisconnect={handleUnlink}
          provider="google"
        />
        <AccountCard
          icon="reddit"
          isConnected={accountLinkingReadiness.linkedProviders.includes(
            "reddit"
          )}
          isLinkingReady={isLinkingReady}
          isLoading={loadingProvider === "reddit"}
          onConnect={handleLinkRequest}
          onDisconnect={handleUnlink}
          provider="reddit"
        />
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setProviderToConfirm(null);
          }
        }}
        open={providerToConfirm !== null}
      >
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[440px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <Link2 className="size-4" />
              </div>
              Connect{" "}
              {providerToConfirm ? providerLabel(providerToConfirm) : "account"}
              ?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Choose the account you want to use as another sign-in method.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            <div
              className={cn(
                "border-border/60 flex items-center gap-3 rounded-xl border bg-[hsl(var(--background))] p-3",
                CARD_SHADOW_CLASS
              )}
            >
              <div className="border-border/60 flex size-10 shrink-0 items-center justify-center rounded-lg border bg-[hsl(var(--background-alt))]">
                {providerToConfirm && (
                  <Image
                    alt=""
                    className="size-5"
                    height={20}
                    src={`/socials/${providerToConfirm}.svg`}
                    width={20}
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {providerToConfirm
                    ? providerLabel(providerToConfirm)
                    : "Provider"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Additional sign-in method
                </p>
              </div>
            </div>

            <p className="text-muted-foreground text-sm leading-relaxed">
              If its email differs from{" "}
              <span className="text-foreground font-medium">{user.email}</span>,
              it will be added to this account without replacing your account
              email.
            </p>
          </div>

          <DialogFooter className="border-border/60 flex-row justify-end gap-2 border-t px-5 py-3 sm:space-x-0">
            <Button
              className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
              onClick={() => setProviderToConfirm(null)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-full px-4 text-sm"
              onClick={handleConfirmedLink}
              variant="premium"
            >
              Continue to{" "}
              {providerToConfirm
                ? providerLabel(providerToConfirm)
                : "provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
