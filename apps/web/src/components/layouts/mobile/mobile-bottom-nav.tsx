"use client";

import {
  Clapperboard,
  Compass,
  Home,
  MessagesSquare,
  Newspaper,
  Users,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import Spinner3D from "@/components/layouts/spinner-3d";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useHideOnPageScroll } from "@/hooks/use-hide-on-scroll";
import { useUnreadMessageCount } from "@/lib/messages/use-unread-messages";
import { cn, formatNumber, isRouteActive } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";

interface MobileNavItem {
  href: string;
  icon: typeof Home;
  label: string;
  requiresAuth?: boolean;
}

// Three destinations a side, split by the centre compose action. The dock is
// icon-only; each tab's name lives in its aria-label and the orange tile carries
// the active state. Bookmarks and Settings are intentionally absent - both are
// already reachable from the mobile profile menu in the top bar.
const LEFT_ITEMS: MobileNavItem[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/gusts", icon: Clapperboard, label: "Gusts" },
  { href: "/discover", icon: Compass, label: "Explore" },
];

const RIGHT_ITEMS: MobileNavItem[] = [
  {
    href: "/messages",
    icon: MessagesSquare,
    label: "Messages",
    requiresAuth: true,
  },
  { href: "/communities", icon: Users, label: "Communities" },
  {
    href: "/hackernews",
    icon: Newspaper,
    label: "HackerNews",
    requiresAuth: true,
  },
];

const formatCount = (count: number) =>
  count > 99 ? "99+" : formatNumber(count);

// A filled plus, not lucide's stroke-only `Plus`. The centre action is the one
// solid glyph in the dock, so it is a real filled path rather than a stroked
// outline pretending to be one.
const FilledPlus: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
  >
    <path d="M14 4h-4v6H4v4h6v6h4v-6h6v-4h-6z" />
  </svg>
);

// Replaces the icon with the app's 3D spinner while that link navigates to a
// DIFFERENT page; hammering the tab you are already on must not flash anything.
const NavIcon: React.FC<{ active: boolean; icon: typeof Home }> = ({
  active,
  icon: Icon,
}) => {
  const { pending } = useLinkStatus();
  if (pending && !active) {
    return <Spinner3D className="size-5" />;
  }
  return <Icon className="size-5 transition-colors" />;
};

const MobileBottomNav: React.FC = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();
  const unreadMessageCount = useUnreadMessageCount();
  const openComposer = useComposerStore((state) => state.openComposer);
  const hidden = useHideOnPageScroll();
  const reduceMotion = useReducedMotion();

  const isInsideActiveChat =
    pathname.startsWith("/messages") && Boolean(searchParams?.get("c"));

  if (isInsideActiveChat) {
    return null;
  }

  const renderTab = ({
    href,
    icon: Icon,
    label,
    requiresAuth,
  }: MobileNavItem) => {
    const isActive = isRouteActive(pathname, href);
    // The active treatment is the desktop sidebar's own `.pill-nav-active`, so
    // both navs speak one language: a tonal primary tint, a hairline primary
    // border and the inner lip, never a saturated fill.
    const className = cn(
      "group relative flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 outline-none",
      isActive
        ? "pill-nav-active"
        : "pill-3d-hover text-muted-foreground hover:text-foreground"
    );

    const inner = (
      <>
        <NavIcon active={isActive} icon={Icon} />
        {href === "/messages" && unreadMessageCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full border border-[hsl(var(--background-alt))] bg-linear-to-b from-[#ff9500] to-[#e65500] px-1 text-[9px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)]">
            {formatCount(unreadMessageCount)}
          </span>
        ) : null}
      </>
    );

    if (requiresAuth && !isLoggedIn) {
      return (
        <button
          aria-label={label}
          className={className}
          key={href}
          onClick={goToLogin}
          type="button"
        >
          {inner}
        </button>
      );
    }

    return (
      <Link aria-label={label} className={className} href={href} key={href}>
        {inner}
      </Link>
    );
  };

  const handleCompose = () => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    openComposer();
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-3 lg:hidden"
    >
      {/* Slides fully below the fold on scroll-down and back on scroll-up. The
          nav stays fixed so nothing reflows; only the inner dock travels, and it
          is visible by default - motion reacts to scrolling, it never gates the
          dock's existence. */}
      <motion.div
        animate={
          reduceMotion
            ? { opacity: hidden ? 0 : 1 }
            : { opacity: hidden ? 0 : 1, y: hidden ? "calc(100% + 1rem)" : 0 }
        }
        initial={false}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="panel-3d mx-auto flex w-fit items-center gap-1.5 rounded-2xl p-1">
          <div className="flex items-center gap-0.5">
            {LEFT_ITEMS.map(renderTab)}
          </div>

          {/* The compose action is deliberately larger than the 40px tab
              squares and breaks the pill's edges. -my-1.5 makes its effective
              height equal the tabs', so the bar keeps its own height while the
              circle pokes ~1px past the border for the proud, floating look. */}
          <button
            aria-label="Create Post"
            className="follow-btn-3d -my-1.5 flex size-13 shrink-0 items-center justify-center"
            onClick={handleCompose}
            type="button"
          >
            <FilledPlus className="size-6" />
          </button>

          <div className="flex items-center gap-0.5">
            {RIGHT_ITEMS.map(renderTab)}
          </div>
        </div>
      </motion.div>
    </nav>
  );
};

export default MobileBottomNav;
