"use client";

import { useEffect, useState } from "react";
import type { KeyboardEventHandler } from "react";

export function SearchRetryButton({
  onRetry,
  onKeyDown,
  retryAt = 0,
}: {
  onRetry: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  retryAt?: number;
}) {
  const [now, setNow] = useState(Date.now);
  const remainingSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (remainingSeconds === 0) {
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [remainingSeconds]);

  return (
    <button
      className="btn-3d-gray inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
      data-search-result
      disabled={remainingSeconds > 0}
      onClick={onRetry}
      onKeyDown={onKeyDown}
      type="button"
    >
      {remainingSeconds > 0 ? `Try again in ${remainingSeconds}s` : "Try again"}
    </button>
  );
}
