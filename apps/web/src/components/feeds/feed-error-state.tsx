import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import Image from "next/image";

export function FeedErrorState({
  message,
  onRetry,
  isRetrying = false,
  compact = false,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
  compact?: boolean;
  retryLabel?: string;
}) {
  return (
    <div
      className={
        compact
          ? "flex w-full flex-col items-center justify-center gap-3 p-4 text-center"
          : "flex min-h-72 w-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
      }
    >
      <Image
        alt=""
        className={
          compact ? "size-16 object-contain" : "size-36 object-contain"
        }
        height={144}
        loading="eager"
        src={errorImage}
        width={144}
      />
      <p className="text-muted-foreground max-w-xs text-sm" role="alert">
        {message}
      </p>
      <Button
        disabled={isRetrying}
        className="rounded-full"
        onClick={onRetry}
        type="button"
        variant="premium"
      >
        {isRetrying ? "Trying again…" : retryLabel}
      </Button>
    </div>
  );
}
