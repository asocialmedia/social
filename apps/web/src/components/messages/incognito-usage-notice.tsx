"use client";
import { incognitoNotice, incognitoUsageDuration } from "@asm/messages";
import type { IncognitoSession } from "@asm/messages";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { Shield } from "lucide-react";

export function IncognitoUsageNotice({
  session,
}: {
  session: IncognitoSession;
}) {
  const started = new Date(session.startedAt).toLocaleString();
  const ended = session.endedAt
    ? new Date(session.endedAt).toLocaleString()
    : null;
  const duration = incognitoUsageDuration(session);
  const timing = ended ? `${started} – ${ended}` : started;
  return (
    <div
      className="my-2 flex justify-center px-4"
      data-incognito-notice={session.id}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${incognitoNotice(session)}. ${timing}${duration ? ` · Duration: ${duration}` : ""}`}
              className="text-muted-foreground focus-visible:ring-ring inline-flex max-w-full cursor-default flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-sm text-center text-[11px] leading-relaxed outline-none focus-visible:ring-1"
            >
              <Shield aria-hidden className="size-2.5 shrink-0 opacity-65" />
              <span aria-hidden>
                {session.startedByName}{" "}
                {session.endedAt ? "used incognito" : "started incognito"}
              </span>
              <time
                aria-hidden
                className="text-[10px] tabular-nums opacity-80"
                dateTime={session.startedAt}
              >
                {new Date(session.startedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              {duration ? (
                <span
                  aria-hidden
                  className="text-[10px] tabular-nums opacity-80"
                >
                  · {duration}
                </span>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-64 text-xs">
              {incognitoNotice(session)}
              <br />
              {timing}
              {duration ? ` · ${duration}` : ""}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
