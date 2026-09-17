"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface TurnstileRenderOptions {
  action: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  appearance: "always";
  sitekey: string;
}

interface TurnstileApi {
  remove: (widgetId: string) => void;
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileWidgetProps {
  onTokenChange: (token: string | null) => void;
  siteKey: string | undefined;
}

export function TurnstileWidget({
  onTokenChange,
  siteKey,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (
      !scriptReady ||
      !siteKey ||
      !containerRef.current ||
      !window.turnstile
    ) {
      return;
    }

    const widgetId = window.turnstile.render(containerRef.current, {
      action: "signup",
      appearance: "always",
      callback: (token) => {
        setUnavailable(false);
        onTokenChange(token);
      },
      "error-callback": () => {
        setUnavailable(true);
        onTokenChange(null);
      },
      "expired-callback": () => {
        setUnavailable(false);
        onTokenChange(null);
      },
      sitekey: siteKey,
    });
    widgetIdRef.current = widgetId;

    return () => {
      window.turnstile?.remove(widgetId);
      widgetIdRef.current = null;
    };
  }, [onTokenChange, scriptReady, siteKey]);

  if (!siteKey) {
    return (
      <p className="text-destructive text-sm" role="alert">
        Account creation is temporarily unavailable. Please try again later.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Script
        onError={() => {
          setUnavailable(true);
          onTokenChange(null);
        }}
        onReady={() => {
          if (window.turnstile) {
            setScriptReady(true);
            return;
          }
          setUnavailable(true);
          onTokenChange(null);
        }}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <output className="text-muted-foreground text-sm">
        {unavailable
          ? "The security check could not load."
          : "Complete the security check to create your account."}
      </output>
      <div className="min-h-16" ref={containerRef} />
      {unavailable ? (
        <p className="text-destructive text-sm" role="alert">
          Please refresh the page and try again. If it persists, disable any
          content blocker for this site.
        </p>
      ) : null}
    </div>
  );
}
