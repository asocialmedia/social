"use client";

import type { CommunityCreationQuota, CommunityData } from "@asm/db";
import { COMMUNITY_MAX_OWNED } from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { Clock, Flame, Info, Sparkles, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import CommunityAvatar from "@/components/communities/community-avatar";
import SearchField from "@/components/layouts/search-field";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { useCommunityCreationQuotaQuery } from "@/lib/communities/client";
import type { CommunitySidebarPayload } from "@/lib/communities/client";
import { cn, formatNumber } from "@/lib/utils";

interface CommunitiesRightRailProps {
  auras: Record<string, number>;
  onCreate: () => void;
  onSelectCategory: (key: string) => void;
  sidebar: CommunitySidebarPayload;
}

// Module-scope fallback so the default prop keeps a stable identity.
const EMPTY_SIDEBAR: CommunitySidebarPayload = {
  activeCategory: null,
  popular: [],
  recentVisits: [],
  topByAura: [],
};

// A genuinely solid plus. Lucide's Plus is two open strokes ("M5 12h14"), which
// enclose no area, so `fill` on it draws nothing - a filled mark needs real
// geometry. Two overlapping rounded rects give a clean solid plus with the
// rounded corners the rest of the app uses, sized by the button's [&_svg] rule.
function FilledPlus() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <rect height="18" rx="3" width="6" x="9" y="3" />
      <rect height="6" rx="3" width="18" x="3" y="9" />
    </svg>
  );
}

// A leading panel icon. `fillable` mirrors the sidebar nav's flag: silhouette
// icons (users, flame) fill cleanly as a solid mark, while glyphs built from a
// closed shape plus detail (clock's circle and hands) turn into a solid blob
// the moment they take a fill, so they stay stroke-only.
function PanelIcon({
  fillable = false,
  icon: Icon,
}: {
  fillable?: boolean;
  icon: LucideIcon;
}) {
  return (
    <Icon
      aria-hidden="true"
      className="text-primary size-4 shrink-0"
      fill={fillable ? "currentColor" : "none"}
    />
  );
}

// One rail row: the community mark, its name, and a right-aligned metric -
// the number a reader scans for, with the identity leading on the left.
function CommunityRow({
  community,
  trailing,
}: {
  community: CommunityData;
  trailing: React.ReactNode;
}) {
  return (
    <Link
      className="sidebar-row-hover flex items-center gap-2.5 rounded-xl px-2 py-1.5"
      href={`/a/${community.slug}`}
    >
      <CommunityAvatar
        accentColor={community.accentColor}
        avatarUrl={community.avatarUrl}
        className="size-8"
        name={community.name}
        slug={community.slug}
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {community.name}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          a/{community.slug}
        </span>
      </span>
      {trailing}
    </Link>
  );
}

// One rail panel: an icon, a heading, and its rows. Hidden entirely when empty
// so a heading never sits over blank space.
function CommunityListCard({
  fillable,
  icon,
  title,
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
  fillable?: boolean;
  icon: LucideIcon;
  title: string;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <div className="sidebar-subcard rounded-2xl p-2">
      <div className="flex items-center gap-2 px-2 pt-1 pb-2">
        <PanelIcon fillable={fillable} icon={icon} />
        <h2 className="text-foreground flex-1 text-sm font-semibold">
          {title}
        </h2>
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

// A right-aligned metric: a small icon and a value, matching the community
// card's stat row so the two read as one system.
function RowMetric({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs">
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="text-primary size-3.5"
          fill="currentColor"
        />
      ) : null}
      <span className="text-foreground font-semibold tabular-nums">
        {value}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const ORDINALS = ["1st", "2nd", "3rd", "4th"] as const;

function ordinal(index: number): string {
  return ORDINALS[index] ?? `${index + 1}th`;
}

// The aura ladder behind community creation, opened from the (i) beside the
// create CTA. It is a standing rule about the account rather than a step of the
// wizard, so it lives next to the button that opens the wizard. Presentational
// only - the service re-checks the gate atomically at write time.
function CreationGatePanel({ quota }: { quota: CommunityCreationQuota }) {
  const requirement = quota.maxed ? null : quota.nextRequirement;
  const eligible = requirement !== null && quota.aura >= requirement;
  const remaining =
    requirement === null ? 0 : Math.max(0, requirement - quota.aura);
  // Only ever shown while an unmet requirement exists, so `requirement` is a
  // real number here and the ratio cannot divide by zero.
  const progress =
    requirement === null || requirement <= 0
      ? 1
      : Math.min(1, quota.aura / requirement);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-semibold">
          Founding is earned
        </p>
        <p className="text-muted-foreground text-xs">
          Each community you start costs aura.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Flame
            aria-hidden="true"
            className={cn("size-3.5", getAuraFlameClass(quota.aura))}
            fill="currentColor"
          />
          Your aura
        </span>
        <span className="text-foreground text-sm font-semibold tabular-nums">
          {formatNumber(quota.aura)}
        </span>
      </div>

      {quota.maxed ? (
        <p className="text-muted-foreground text-xs">
          You have founded all {COMMUNITY_MAX_OWNED} communities.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              Your {ordinal(quota.owned)} community
            </span>
            <span className="text-foreground text-xs font-semibold tabular-nums">
              {formatNumber(requirement ?? 0)} aura
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
              ? "You're ready to found it."
              : `${formatNumber(remaining)} aura to go.`}
          </p>
        </div>
      )}
    </div>
  );
}

// Right rail for /communities: the create call to action, then the reader's
// useful shortlists - biggest, highest-aura, the busiest category, and their
// own recent trail. Same 3D surface language as the rest of the app.
export default function CommunitiesRightRail({
  auras,
  onCreate,
  onSelectCategory,
  sidebar = EMPTY_SIDEBAR,
}: CommunitiesRightRailProps) {
  const { activeCategory, popular, recentVisits, topByAura } = sidebar;
  const { user } = useSession();
  // Fetched only for signed-in readers; signed-out visitors cannot create at
  // all, so the (i) stays hidden and no request is made.
  const quota = useCommunityCreationQuotaQuery(Boolean(user));

  // Signed-out readers are left enabled on purpose: the click routes them to
  // sign-in, which is the correct next step. Only a loaded, unmet quota for a
  // signed-in account disables the button.
  const blocked = Boolean(quota.data && !quota.data.canCreate);
  let blockedReason: string | null = null;
  if (blocked && quota.data) {
    blockedReason = quota.data.maxed
      ? `All ${COMMUNITY_MAX_OWNED} communities founded`
      : `Needs ${formatNumber(quota.data.nextRequirement ?? 0)} aura`;
  }

  return (
    <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l px-3 pt-3 pb-6 xl:flex">
      <SearchField />

      {/* Create CTA. The button carries the app's orange 3D bevel (btn-3d via
          the premium variant); rounded-lg overrides its default pill so it
          matches the community controls' squircle edge. */}
      <div className="sidebar-subcard relative overflow-hidden rounded-2xl p-4">
        <Sparkles
          aria-hidden="true"
          className="text-primary pointer-events-none absolute -top-2 -right-2 size-16 opacity-10"
          fill="currentColor"
        />
        <div className="relative flex items-center gap-1.5">
          <h2 className="text-foreground text-sm font-bold tracking-tight">
            Start a community
          </h2>
          {/* The gate, explained where the action is. Click, not hover: it is
              a small panel of real information, so it needs to be readable and
              dismissible rather than fleeting. */}
          {quota.data ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  aria-label="How founding a community is unlocked"
                  className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground -m-1 flex items-center justify-center rounded-md p-1 transition-colors"
                  type="button"
                >
                  <Info className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-64 p-3.5"
                side="bottom"
              >
                <CreationGatePanel quota={quota.data} />
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        <p className="text-muted-foreground relative mt-1 text-xs">
          Bring people together around the thing you cannot stop talking about.
        </p>
        {/* The gate disables the triggering button rather than failing the
            submit at the end of the wizard. A disabled button emits no pointer
            events, so the span carries the tooltip. */}
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="relative mt-3.5 block w-full">
                <Button
                  className="h-10 w-full rounded-lg text-[15px]"
                  disabled={blocked}
                  onClick={onCreate}
                  variant="premium"
                >
                  <FilledPlus />
                  Create community
                </Button>
              </span>
            </TooltipTrigger>
            {blocked && blockedReason ? (
              <TooltipContent side="bottom">{blockedReason}</TooltipContent>
            ) : null}
          </Tooltip>
        </TooltipProvider>
      </div>

      <CommunityListCard
        count={popular.length}
        fillable
        icon={Users}
        title="Popular communities"
      >
        {popular.map((community) => (
          <li key={community.id}>
            <CommunityRow
              community={community}
              trailing={
                <RowMetric
                  icon={Users}
                  label="members"
                  value={formatNumber(community._count.members)}
                />
              }
            />
          </li>
        ))}
      </CommunityListCard>

      {/* Highest-aura rank: the community's own output, so the metric is the
          same aura the cards and profiles show. */}
      <CommunityListCard
        count={topByAura.length}
        fillable
        icon={Flame}
        title="Top by aura"
      >
        {topByAura.map((community) => (
          <li key={community.id}>
            <CommunityRow
              community={community}
              trailing={
                <RowMetric
                  icon={Flame}
                  label="aura"
                  value={formatNumber(auras[community.id] ?? 0)}
                />
              }
            />
          </li>
        ))}
      </CommunityListCard>

      {/* Most active category: a filter shortcut, so it routes back into the
          grid rather than to a community. */}
      {activeCategory ? (
        <div className="sidebar-subcard rounded-2xl p-2">
          <div className="flex items-center gap-2 px-2 pt-1 pb-2">
            <PanelIcon icon={TrendingUp} />
            <h2 className="text-foreground flex-1 text-sm font-semibold">
              Most active category
            </h2>
          </div>
          <button
            className="sidebar-row-hover flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left"
            onClick={() => onSelectCategory(activeCategory.key)}
            type="button"
          >
            <span className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-xl">
              <TrendingUp
                aria-hidden="true"
                className="text-primary size-4"
                fill="none"
              />
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {activeCategory.label}
            </span>
            <RowMetric
              label="posts"
              value={formatNumber(activeCategory.count)}
            />
          </button>
        </div>
      ) : null}

      {/* The viewer's own trail, each row stamped with how long ago. Absent for
          guests and first-time visitors. */}
      <CommunityListCard
        count={recentVisits.length}
        icon={Clock}
        title="Recently visited"
      >
        {recentVisits.map((visit) => (
          <li key={visit.community.id}>
            <CommunityRow
              community={visit.community}
              trailing={
                <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                  {formatDistanceToNow(new Date(visit.visitedAt), {
                    addSuffix: true,
                  })}
                </span>
              }
            />
          </li>
        ))}
      </CommunityListCard>
    </aside>
  );
}
