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
import {
  SettingsCard,
  SettingsStatusChip,
} from "@/components/settings/settings-section-card";
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

interface ProviderCardProps {
  isConnected: boolean;
  isLinkingReady: boolean;
  isLoading: boolean;
  onClick: () => void;
  provider: SocialProvider;
}

// One sign-in provider as its own square card. The logo sits bare on the card
// surface (no tile behind it), and the action lives on the last line so the two
// cards stay aligned.
const ProviderCard = ({
  isConnected,
  isLinkingReady,
  isLoading,
  onClick,
  provider,
}: ProviderCardProps) => (
  <SettingsCard className="flex h-full flex-col gap-4">
    <div className="flex items-center gap-3">
      <Image
        alt=""
        className="size-7 shrink-0"
        height={28}
        src={`/socials/${provider}.svg`}
        width={28}
      />
      <div className="min-w-0">
        <p className="truncate font-semibold">{providerLabel(provider)}</p>
        <SettingsStatusChip on={isConnected}>
          {isConnected ? "Connected" : "Not connected"}
        </SettingsStatusChip>
      </div>
    </div>

    <div className="mt-auto">
      <LoadingButton
        className={cn(
          "h-9 w-full rounded-xl text-sm",
          isConnected ? "icon-btn-3d" : "follow-btn-3d"
        )}
        disabled={!isConnected && !isLinkingReady}
        loading={isLoading}
        onClick={onClick}
      >
        {isConnected ? "Disconnect" : "Connect"}
      </LoadingButton>
    </div>
  </SettingsCard>
);

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

  const googleConnected =
    accountLinkingReadiness.linkedProviders.includes("google");
  const redditConnected =
    accountLinkingReadiness.linkedProviders.includes("reddit");

  return (
    <div className="space-y-3">
      {isLinkingReady ? null : (
        <p className="text-muted-foreground text-sm">
          Verify an email address and add a password before connecting another
          sign-in method.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <ProviderCard
          isConnected={googleConnected}
          isLoading={loadingProvider === "google"}
          isLinkingReady={isLinkingReady}
          onClick={() =>
            googleConnected
              ? handleUnlink("google")
              : handleLinkRequest("google")
          }
          provider="google"
        />
        <ProviderCard
          isConnected={redditConnected}
          isLoading={loadingProvider === "reddit"}
          isLinkingReady={isLinkingReady}
          onClick={() =>
            redditConnected
              ? handleUnlink("reddit")
              : handleLinkRequest("reddit")
          }
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
            <div className="border-border/60 flex items-center gap-3 rounded-xl border p-3">
              {providerToConfirm && (
                <Image
                  alt=""
                  className="size-6 shrink-0"
                  height={24}
                  src={`/socials/${providerToConfirm}.svg`}
                  width={24}
                />
              )}
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
