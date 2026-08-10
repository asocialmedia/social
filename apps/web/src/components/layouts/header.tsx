"use client";

import { Cover } from "@asm/ui/components/ui/cover";
import { Badge } from "@asm/ui/shadui/badge";
import { Tabs, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import {
  Bookmark,
  Compass,
  Globe2Icon,
  Home,
  MoreHorizontal,
  Newspaper,
  Settings,
  UsersIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { Playwrite_CA } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { getRandomFact } from "@/components/constants/loading-facts";
import MobileSearchButton from "@/components/layouts/mobile/mobile-search-button";
import SearchToggle from "@/components/layouts/search-toggle";
import { cn } from "@/lib/utils";
import { HeaderIconButton } from "../styles/header-buttons";
import HeaderBookmarksButton from "./header-bookmarks-button";
import NotificationsButton from "./notifications-button";
import UserButtonWrapper from "./user-button-wrapper";

const playwriteCa = Playwrite_CA({ weight: "400" });

interface MobileMoreMenuProps {
  hideTrigger?: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  unreadMessageCount?: number;
}

const MobileMoreMenu = ({
  open,
  setOpen,
  hideTrigger = false,
}: MobileMoreMenuProps) => {
  const [fact, setFact] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFact(getRandomFact());
    }
  }, [open]);

  return (
    <>
      {!hideTrigger && (
        <motion.div
          className="flex flex-col items-center px-4"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/noStaticElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/useKeyWithClickEvents: ignore */}
          <div
            className="flex flex-col items-center"
            onClick={() => setOpen(true)}
          >
            <div className="relative flex items-center justify-center">
              <MoreHorizontal className="h-[18px] w-[18px] text-muted-foreground" />
            </div>
            <span className="mt-0.5 font-medium text-[10px] text-muted-foreground">
              More
            </span>
          </div>
        </motion.div>
      )}

      {open && (
        <div className="fixed inset-0 z-[200] md:hidden">
          {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/noStaticElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/useKeyWithClickEvents: ignore */}
          <div
            className="fixed inset-0 bg-background/90 backdrop-blur-lg"
            onClick={() => setOpen(false)}
          />
          {fact && (
            <div className="fixed top-4 right-0 left-0 z-[202] flex justify-center px-4">
              <div className="rounded-full border border-border/50 bg-card/80 px-3 py-1.5 text-center shadow-sm backdrop-blur">
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {fact}
                </span>
              </div>
            </div>
          )}
          {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/noStaticElementInteractions: ignore */}
          {/** biome-ignore lint/a11y/useKeyWithClickEvents: ignore */}
          <div
            className="fixed inset-0 z-[201] flex items-center justify-center p-3"
            onClick={(e) => {
              if (e.currentTarget === e.target) {
                setOpen(false);
              }
            }}
            onMouseDown={(e) => {
              if (e.currentTarget === e.target) {
                setOpen(false);
              }
            }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="w-full max-w-md"
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-4 shadow-lg backdrop-blur-xl">
                <button
                  className="absolute top-2 right-2 rounded-full p-1.5 text-muted-foreground hover:bg-primary/10"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    className="flex flex-col items-center justify-center rounded-xl border border-border/50 p-3 hover:bg-primary/10"
                    href="/discover"
                    onClick={() => setOpen(false)}
                  >
                    <Compass className="h-5 w-5" />
                    <span className="mt-1 text-xs">Discover</span>
                  </Link>
                  <Link
                    className="flex flex-col items-center justify-center rounded-xl border border-border/50 p-3 hover:bg-primary/10"
                    href="/settings"
                    onClick={() => setOpen(false)}
                  >
                    <Settings className="h-5 w-5" />
                    <span className="mt-1 text-xs">Settings</span>
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </>
  );
};

interface MobileNavLinkProps {
  badge?: number;
  href: string;
  icon: React.ReactNode;
  label: string;
}

const MobileNavLink = ({
  href,
  icon,
  label,
  badge = 0,
}: MobileNavLinkProps) => {
  const pathname = usePathname();
  const isActivePath = (path: string) => pathname === path;
  const isActive = isActivePath(href);

  return (
    <motion.div
      className="flex flex-col items-center px-4"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <Link
        className={cn(
          "relative flex flex-col items-center",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
        href={href}
      >
        <div className="relative flex items-center justify-center">
          {icon}
          {badge > 0 && (
            <motion.div
              animate={{ scale: 1 }}
              className="absolute -top-1.5 -right-1.5"
              initial={{ scale: 0 }}
              transition={{ type: "spring" }}
            >
              <Badge
                className="flex h-3.5 w-3.5 items-center justify-center p-0 font-medium text-[9px]"
                variant="secondary"
              >
                {badge}
              </Badge>
            </motion.div>
          )}
        </div>
        <span className="mt-0.5 font-medium text-[10px]">{label}</span>
        {isActive && (
          <motion.div
            className="absolute -bottom-1.5 h-[2px] w-4 bg-primary"
            layoutId="activeIndicator"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
      </Link>
    </motion.div>
  );
};

interface HeaderProps {
  bookmarkCount: number;
  unreadNotificationCount: number;
}

const Header: React.FC<HeaderProps> = ({
  bookmarkCount,
  unreadNotificationCount,
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = (searchParams.get("tab") || "for-you") as "for-you" | "following";
  const isActivePath = (path: string) => pathname === path;

  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  return (
    <>
      <motion.header
        animate={{ y: 0, opacity: 1 }}
        className="fixed top-0 right-0 left-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center overflow-visible bg-background px-4 py-0.5 sm:px-6"
        initial={{ y: -20, opacity: 0 }}
      >
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/">
            <motion.h1
              className="mr-1 -rotate-6 font-bold text-xl md:-rotate-10"
              whileHover={{ scale: 1.05 }}
            >
              <span className={playwriteCa.className}>
                <Cover className="text-primary">asocialmedia.</Cover>
              </span>
            </motion.h1>
          </Link>
          <div className="hidden md:block">
            <SearchToggle />
          </div>
        </div>

        <div className="w-full min-w-0 max-w-[240px] justify-self-center px-1 md:hidden">
          <MobileSearchButton />
        </div>

        <div className="absolute top-1/2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-12 md:flex">
          {isActivePath("/") && (
            <Tabs
              className="contents"
              onValueChange={(value) => {
                const next = value === "for-you" ? "/" : "/?tab=following";
                router.push(next);
              }}
              value={tab}
            >
              <TabsList className="contents">
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <TabsTrigger
                        className="group for-you relative flex cursor-pointer items-center justify-center overflow-visible rounded-full p-2 hover:bg-background/60"
                        value="for-you"
                      >
                        <span className="relative z-10 flex items-center">
                          <Globe2Icon
                            className={cn(
                              "h-5 w-5 transition-colors",
                              tab === "for-you"
                                ? "text-primary"
                                : "text-muted-foreground"
                            )}
                          />
                          <span
                            className={cn(
                              "pointer-events-none absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary transition-opacity",
                              tab === "for-you" ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </span>
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Globals</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <TabsTrigger
                        className="group following relative flex cursor-pointer items-center justify-center overflow-visible rounded-full p-2 hover:bg-background/60"
                        value="following"
                      >
                        <span className="relative z-10 flex items-center">
                          <UsersIcon
                            className={cn(
                              "h-5 w-5 transition-colors",
                              tab === "following"
                                ? "text-primary"
                                : "text-muted-foreground"
                            )}
                          />
                          <span
                            className={cn(
                              "pointer-events-none absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary transition-opacity",
                              tab === "following" ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </span>
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Following</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TabsList>
            </Tabs>
          )}
          {!isActivePath("/") && (
            <div className="hidden md:inline-flex">
              <HeaderIconButton
                href="/"
                icon={<Home className="h-5 w-5" />}
                title="Home"
              />
            </div>
          )}
          <div className="hidden md:inline-flex">
            <HeaderBookmarksButton count={bookmarkCount} />
          </div>
          <div className="hidden md:inline-flex">
            <NotificationsButton
              initialState={{ unreadCount: unreadNotificationCount }}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 justify-self-end px-1 sm:gap-3">
          <div className="shrink-0 pr-1 md:hidden">
            <NotificationsButton
              initialState={{ unreadCount: unreadNotificationCount }}
              mode="mobile"
            />
          </div>
          <div className="shrink-0">
            <UserButtonWrapper />
          </div>
        </div>
      </motion.header>

      <div className="h-14" />

      {!isMobileMoreOpen && (
        <div
          className="fixed right-0 left-0 z-40 flex justify-center md:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
        >
          <motion.div
            animate={{ y: 0, opacity: 1 }}
            className="mx-auto flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-2 shadow-lg backdrop-blur-lg"
            initial={{ y: 20, opacity: 0 }}
          >
            <MobileNavLink
              href="/"
              icon={<Home className="h-[18px] w-[18px]" />}
              label="Home"
            />

            <MobileNavLink
              badge={bookmarkCount}
              href="/bookmarks"
              icon={<Bookmark className="h-[18px] w-[18px]" />}
              label="Bookmarks"
            />

            <MobileNavLink
              href="/hackernews"
              icon={<Newspaper className="h-[18px] w-[18px]" />}
              label="HackerNews"
            />

            <div className="flex flex-col items-center pl-0">
              <MobileMoreMenu
                open={isMobileMoreOpen}
                setOpen={setIsMobileMoreOpen}
              />
            </div>
          </motion.div>
        </div>
      )}

      <MobileMoreMenu
        hideTrigger
        open={isMobileMoreOpen}
        setOpen={setIsMobileMoreOpen}
      />
    </>
  );
};

export default Header;
