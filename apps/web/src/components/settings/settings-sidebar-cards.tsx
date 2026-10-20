"use client";

import { Check, Copy, Heart, Mail, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { FaGithub } from "react-icons/fa";

import { toast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

const GITHUB_REPO_URL = "https://github.com/asocialmedia/social";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/asocialmedia";
const SUPPORT_EMAIL = "hello@asocialmedia.cc";

interface RepoStatsResponse {
  stargazers_count?: number;
}

// Minimal, black-themed GitHub project card with repo link, description, and star action button.
export function GithubProjectCard({ className = "" }: { className?: string }) {
  const [stars, setStars] = useState<number>(7);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      try {
        const response = await fetch(
          "https://api.github.com/repos/asocialmedia/social",
          {
            headers: { Accept: "application/vnd.github.v3+json" },
          }
        );
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as RepoStatsResponse;
        if (!isMounted || !data) {
          return;
        }
        if (typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      } catch {
        // Fall back gracefully to preset defaults
      }
    }

    void loadStats();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-black p-3.5 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.1),0_4px_16px_rgba(0,0,0,0.5)]",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <Link
          className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-85"
          href={GITHUB_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white shadow-inner">
            <FaGithub className="size-4" />
          </div>
          <span className="truncate text-xs font-semibold text-white">
            asocialmedia<span className="text-zinc-500">/social</span>
          </span>
        </Link>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-zinc-300">
        Building the last social platform you&apos;ll ever need. Open source,
        cozy, and sovereign.
      </p>

      <div className="mt-3">
        <Link
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-gradient-to-b from-zinc-800 to-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.4)] transition-all hover:from-zinc-700 hover:to-zinc-800 active:translate-y-px"
          href={GITHUB_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Star className="size-3.5 fill-[#e3b341] text-[#e3b341]" />
          <span>Star on GitHub</span>
          <span className="py-0.2 ml-1 rounded-full bg-white/10 px-1.5 text-[11px] font-bold text-zinc-200 tabular-nums">
            {stars}
          </span>
        </Link>
      </div>
    </div>
  );
}

// Minimal sponsor project card with description and GitHub Sponsors 3D button
export function SponsorProjectCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-rose-500/20 bg-gradient-to-b from-[#160b13] to-black p-3.5 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.1),inset_0_1px_2px_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.5)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Heart className="size-3.5 fill-rose-400 text-rose-400" />
          <span className="text-xs font-semibold text-white">Sponsor</span>
        </div>
        <span className="text-[11px] text-zinc-400">Independent OSS</span>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-zinc-300">
        Help keep asocialmedia free, tracker-free, and independently funded for
        everyone.
      </p>

      <div className="mt-3">
        <Link
          className="btn-3d-sponsor flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white transition-all active:translate-y-px"
          href={GITHUB_SPONSORS_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Heart className="size-3 fill-white text-white" />
          <span>Sponsor on GitHub</span>
        </Link>
      </div>
    </div>
  );
}

// Minimal Support & Contact Card with description for reaching out to hello@asocialmedia.cc
export function SupportContactCard({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (event: React.MouseEvent) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      toast({
        description: `${SUPPORT_EMAIL} copied to clipboard`,
        title: "Copied",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        description: `Please email ${SUPPORT_EMAIL}`,
        title: "Contact",
      });
    }
  }, []);

  return (
    <div className={cn("surface-3d rounded-2xl! p-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="size-3.5 text-[#ff9500]" />
          <span className="text-xs font-semibold">Support</span>
        </div>
        <Link
          className="text-muted-foreground hover:text-foreground text-[11px] transition-colors"
          href="/support"
        >
          FAQ
        </Link>
      </div>

      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        For any account, security, or general issue, reach out directly:
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs dark:bg-black/40">
        <a
          className="truncate font-mono text-[11px] text-zinc-300 transition-colors hover:text-white"
          href={`mailto:${SUPPORT_EMAIL}`}
        >
          {SUPPORT_EMAIL}
        </a>
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-white"
          onClick={handleCopy}
          title="Copy email address"
          type="button"
        >
          {copied ? (
            <Check className="size-3 text-emerald-400" />
          ) : (
            <Copy className="size-3" />
          )}
          <span className="sr-only">Copy email</span>
        </button>
      </div>
    </div>
  );
}
