"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

export const INCOGNITO_SURFACE_CLASS_NAME =
  "dark bg-zinc-950 text-zinc-100 [color-scheme:dark] [--background:240_10%_4%] [--border:240_4%_20%] [--card:240_5%_10%] [--chat-accent-from:#71717a] [--chat-accent-to:#52525b] [--foreground:0_0%_95%] [--muted-foreground:240_5%_65%] [--muted:240_4%_15%]";

export function ChatModeTransition({
  sessionId,
  incognito,
  children,
}: {
  sessionId: string | null;
  incognito: ReactNode;
  children: ReactNode;
}) {
  // An already open session needs no entrance when returning to the conversation.
  const [revealedSessionId, setRevealedSessionId] = useState(sessionId);
  const revealing = Boolean(sessionId && sessionId !== revealedSessionId);
  const finishReveal = useCallback(() => {
    setRevealedSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!revealing) {
      return;
    }
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finishIfReduced = () => {
      if (preference.matches) {
        finishReveal();
      }
    };
    // CSS applies the preference immediately; this also prevents a later replay.
    queueMicrotask(finishIfReduced);
    preference.addEventListener("change", finishIfReduced);
    return () => preference.removeEventListener("change", finishIfReduced);
  }, [finishReveal, revealing]);

  return (
    <div
      className="relative isolate flex min-h-0 flex-1 overflow-hidden"
      data-chat-mode-stage
    >
      <div
        className="chat-normal-transcript flex min-h-0 flex-1 flex-col"
        data-obscured={sessionId ? "true" : undefined}
        data-revealing={revealing ? "true" : undefined}
        inert={Boolean(sessionId)}
        aria-hidden={sessionId ? true : undefined}
      >
        {children}
      </div>
      {sessionId ? (
        <div
          key={sessionId}
          className={`chat-incognito-reveal absolute inset-0 z-10 overflow-hidden ${INCOGNITO_SURFACE_CLASS_NAME}`}
          data-revealing={revealing ? "true" : undefined}
          onAnimationEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.animationName === "chat-incognito-rise"
            ) {
              finishReveal();
            }
          }}
        >
          <div className="chat-incognito-reveal-content flex h-full min-h-0 flex-col">
            {incognito}
          </div>
          {revealing ? (
            <span
              aria-hidden
              className="chat-incognito-reveal-edge pointer-events-none absolute inset-x-0 top-0 z-10 h-8 overflow-hidden bg-linear-to-b from-white/[0.035] via-white/[0.01] to-transparent [contain:paint]"
            >
              <span className="absolute inset-x-[6%] -top-1 h-2 rounded-full bg-linear-to-r from-transparent via-white/[0.14] to-transparent blur-[3px]" />
              <span className="relative block h-px bg-linear-to-r from-transparent via-white/[0.18] to-transparent" />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
