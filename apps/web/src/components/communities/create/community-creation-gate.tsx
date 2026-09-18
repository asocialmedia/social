"use client";

import type { CommunityCreationQuota } from "@asm/db";
import { COMMUNITY_MAX_OWNED } from "@asm/db/communities";
import { Flame, Lock } from "lucide-react";

import { getAuraFlameClass } from "@/lib/aura/aura";
import { cn, formatNumber } from "@/lib/utils";

const ORDINALS = ["1st", "2nd", "3rd", "4th"] as const;

function ordinal(index: number): string {
  return ORDINALS[index] ?? `${index + 1}th`;
}

// The gate behind community creation. It is a standing rule about the account
// rather than a step of the wizard, so it is surfaced next to whichever control
// opens the wizard (the right rail's (i) on desktop, the mobile (i) when the
// account is not yet eligible). Presentational only - the service re-checks the
// gate atomically at write time.
//
// Two numbers are shown on purpose. Aura is the reward score (flame colour,
// leaderboards) and stays uncapped so a viral post pays off fully. Standing is
// the credential the bar actually reads: the same earned aura, but with
// attention-milestone aura (views, shares) counted only up to an allowance, so
// one lucky post cannot clear a permanent bar. See COMMUNITY_REACH_ALLOWANCE.
export default function CommunityCreationGate({
  quota,
}: {
  quota: CommunityCreationQuota;
}) {
  const requirement = quota.maxed ? null : quota.nextRequirement;
  const eligible = requirement !== null && quota.standing >= requirement;
  const remaining =
    requirement === null ? 0 : Math.max(0, requirement - quota.standing);
  // Only rendered while an unmet requirement exists, where `requirement` is a
  // real positive number, so the ratio cannot divide by zero.
  const progress =
    requirement === null || requirement <= 0
      ? 1
      : Math.min(1, quota.standing / requirement);
  // Reach was earned but clipped by the allowance - worth saying, so a viral
  // author understands why their aura is higher than their standing.
  const reachCapped = quota.reachAura > quota.reachCounted;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-semibold">
          Founding is earned
        </p>
        <p className="text-muted-foreground text-xs">
          Standing grows with what you contribute.
        </p>
      </div>

      <dl className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Flame
              aria-hidden="true"
              className={cn("size-3.5", getAuraFlameClass(quota.aura))}
              fill="currentColor"
            />
            Aura
          </dt>
          <dd className="text-muted-foreground text-xs font-medium tabular-nums">
            {formatNumber(quota.aura)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-foreground text-xs font-medium">Standing</dt>
          <dd className="text-foreground text-sm font-semibold tabular-nums">
            {formatNumber(quota.standing)}
          </dd>
        </div>
      </dl>

      {quota.maxed ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          You have founded all {COMMUNITY_MAX_OWNED} communities.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              Your {ordinal(quota.owned)} community
            </span>
            <span className="text-foreground text-xs font-semibold tabular-nums">
              bar {formatNumber(requirement ?? 0)}
            </span>
          </div>
          {/* A single tonal meter to the next threshold, flat and unlit. The
              width is the value itself, not an animation. */}
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {eligible
              ? "You've cleared the bar."
              : `${formatNumber(remaining)} standing to the bar.`}
          </p>
        </div>
      )}

      {reachCapped ? (
        <p className="text-muted-foreground border-border/60 border-t pt-2 text-xs">
          Reach from views and shares counts up to{" "}
          {formatNumber(quota.reachCounted)} toward standing.
        </p>
      ) : null}
    </div>
  );
}
