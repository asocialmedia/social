import { clientLog } from "@asm/config/debug";

import type { UserData } from "@asm/db";
import { Link2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import LoadingButton from "@/components/auth/loading-button";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface LinkedAccountsProps {
  onLink: (provider: string) => void;
  user: UserData;
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
  isComingSoon?: boolean;
  isConnected?: boolean;
  isLoading?: boolean;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  provider: string;
}

const AccountCard = ({
  provider,
  icon,
  isConnected,
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
        "flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-[hsl(var(--background))] p-4",
        CARD_SHADOW_CLASS,
        isComingSoon && "opacity-50"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[hsl(var(--background-alt))]">
          <Image
            alt={provider}
            className="size-5"
            height={20}
            src={`/socials/${icon}.svg`}
            width={20}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{provider}</p>
          <p className="truncate text-muted-foreground text-xs">
            {getStatusText(isComingSoon, isConnected)}
          </p>
        </div>
      </div>
      <LoadingButton
        className={cn(
          "h-8 shrink-0 rounded-full px-3 text-xs",
          isConnected ? "icon-btn-3d" : "follow-btn-3d"
        )}
        disabled={isComingSoon}
        loading={isLoading}
        onClick={handleClick}
      >
        {getButtonText(isComingSoon, isConnected)}
      </LoadingButton>
    </div>
  );
};

export default function LinkedAccounts({ user, onLink }: LinkedAccountsProps) {
  const { toast } = useToast();
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const handleLink = useCallback(
    (provider: string) => {
      setLoadingProvider(provider);
      onLink(provider);
    },
    [onLink]
  );

  const handleUnlink = useCallback(
    async (provider: string) => {
      setLoadingProvider(provider);
      try {
        const response = await fetch(`/api/auth/unlink/${provider}`, {
          method: "POST",
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to unlink account");
        }

        toast({
          title: "Account Unlinked",
          description: `Your ${provider} account is no longer connected`,
        });

        window.location.reload();
      } catch (error) {
        clientLog.error("Unlink account error:", error);
        toast({
          variant: "destructive",
          title: "Couldn't Unlink",
          description: "Couldn't unlink that account, try again?",
        });
      } finally {
        setLoadingProvider(null);
      }
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

      <div className="grid gap-4 sm:grid-cols-2">
        <AccountCard
          icon="google"
          isConnected={!!user.googleId}
          isLoading={loadingProvider === "google"}
          onConnect={handleLink}
          onDisconnect={handleUnlink}
          provider="Google"
        />
        <AccountCard
          icon="reddit"
          isConnected={!!user.redditId}
          isLoading={loadingProvider === "reddit"}
          onConnect={handleLink}
          onDisconnect={handleUnlink}
          provider="Reddit"
        />
      </div>
    </div>
  );
}
