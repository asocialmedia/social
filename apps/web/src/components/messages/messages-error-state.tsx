"use client";

import { MESSAGES_CONNECTION_ERROR } from "@asm/ui/lib/messages-errors";
import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import { RefreshCw } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function MessagesErrorState({
  action,
  compact = false,
  collapsed = false,
  message = MESSAGES_CONNECTION_ERROR,
  onRetry,
}: {
  action?: ReactNode;
  compact?: boolean;
  collapsed?: boolean;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 p-6 text-center",
        !compact && "min-h-64 flex-1 justify-center",
        collapsed && "gap-2 px-2"
      )}
    >
      <Image
        alt=""
        className={cn(
          "object-contain",
          compact ? "size-12" : "size-36",
          collapsed && "size-8"
        )}
        height={144}
        loading="eager"
        src={errorImage}
        width={144}
      />
      <p
        className={cn(
          "text-muted-foreground max-w-[340px] text-sm leading-5",
          collapsed && "sr-only"
        )}
        role="alert"
      >
        {message}
      </p>
      {action}
      {onRetry ? (
        <Button
          aria-label="Retry Messages"
          className={cn("btn-3d-gray", collapsed && "size-10 px-0! py-0!")}
          onClick={onRetry}
          type="button"
          variant="premium"
        >
          {collapsed ? <RefreshCw className="size-4" /> : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}
