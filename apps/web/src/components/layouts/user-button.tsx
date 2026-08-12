"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  LogOutIcon,
  Monitor,
  Moon,
  Settings2Icon,
  Sun,
  UserIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { useLogout } from "@/hooks/use-logout";
import { cn } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";
import { LogoutDialog } from "./logout-dialog";
import { MobileUserMenu } from "./mobile/mobile-user-menu";

interface UserButtonProps {
  asChild?: boolean;
  children?: React.ReactNode | ((open: boolean) => React.ReactNode);
  className?: string;
}

interface UserTriggerProps {
  avatarUrl?: string | null;
  className?: string;
}

const UserTrigger = ({ avatarUrl, className }: UserTriggerProps) => (
  <motion.div
    className="group relative"
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
  >
    <div className="absolute -inset-[2px] rounded-full bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100" />
    <Button
      className={cn(
        "relative flex-none cursor-pointer rounded-full border border-border/50 bg-background/40 p-0 shadow-xs backdrop-blur-md transition-all duration-200 hover:border-border/80 hover:bg-background/60 hover:shadow-md",
        className
      )}
      variant="ghost"
    >
      <UserAvatar
        avatarUrl={avatarUrl}
        className="transition-transform duration-200"
        priority
        size={35}
      />
    </Button>
  </motion.div>
);

export default function UserButton({
  className,
  asChild = false,
  children,
}: UserButtonProps) {
  const { user } = useSession();
  const { theme, setTheme } = useTheme();
  const {
    closeLogoutDialog,
    handleLogout,
    logoutDialogOpen,
    openLogoutDialog,
  } = useLogout();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const { data: avatarData } = useQuery({
    queryKey: ["avatar", user.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/users/avatar/${user.id}`);
        if (!response.ok) {
          throw new Error("Failed to fetch avatar");
        }
        const data = await response.json();
        return {
          url: getSecureImageUrl(data.url),
          key: data.key,
        };
      } catch {
        return {
          url: user.image ? getSecureImageUrl(user.image) : null,
          key: null,
        };
      }
    },
    initialData: {
      url: user.image ? getSecureImageUrl(user.image) : null,
      key: null,
    },
    staleTime: 1000 * 60 * 5,
  });

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const [menuOpen, setMenuOpen] = useState(false);

  const handleOpenMobileMenu = useCallback(() => setIsMobileMenuOpen(true), []);
  const handleMobileMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsMobileMenuOpen(true);
      }
    },
    []
  );
  const handleCloseMobileMenu = useCallback(
    () => setIsMobileMenuOpen(false),
    []
  );
  const handleThemeSelect = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const value = e.currentTarget.getAttribute("data-theme-value");
      if (value) {
        setTheme(value);
      }
    },
    [setTheme]
  );

  if (!isMounted) {
    return null;
  }

  const handleOpenDialog = () => {
    openLogoutDialog();
    setIsMobileMenuOpen(false);
  };

  if (isMobile) {
    return (
      <>
        <button
          aria-label="Open user menu"
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={handleOpenMobileMenu}
          onKeyDown={handleMobileMenuKeyDown}
          type="button"
        >
          <UserTrigger avatarUrl={avatarData?.url} />
        </button>

        <MobileUserMenu
          isOpen={isMobileMenuOpen}
          onCloseAction={handleCloseMobileMenu}
          onLogoutAction={handleOpenDialog}
          setThemeAction={setTheme}
          theme={theme}
          user={{
            ...user,
            avatarUrl: avatarData?.url,
            email: user.email || "No email provided",
          }}
        />

        <LogoutDialog
          onCloseAction={closeLogoutDialog}
          onLogoutAction={handleLogout}
          open={logoutDialogOpen}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          {asChild ? (
            <div
              className={cn(
                "z-40 flex cursor-pointer items-center gap-2",
                className
              )}
            >
              <UserAvatar
                avatarUrl={avatarData?.url}
                className="transition-transform duration-200"
                priority
                size={32}
              />
              {typeof children === "function"
                ? (children(menuOpen) ?? null)
                : (children ?? null)}
            </div>
          ) : (
            <div className="z-40">
              <UserTrigger avatarUrl={avatarData?.url} />
            </div>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="z-50 w-56 overflow-hidden rounded-xl border border-border/50 bg-background/75 shadow-lg backdrop-blur-xl"
          sideOffset={8}
        >
          <motion.div
            animate="open"
            className="relative"
            initial="closed"
            variants={{
              closed: {
                opacity: 0,
                scale: 0.96,
                transformOrigin: "top right",
              },
              open: {
                opacity: 1,
                scale: 1,
                transition: {
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                  mass: 0.8,
                  staggerChildren: 0.1,
                },
              },
            }}
          >
            <motion.div
              className="relative overflow-hidden"
              variants={{
                closed: { opacity: 0, y: -10 },
                open: {
                  opacity: 1,
                  y: 0,
                  transition: {
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                  },
                },
              }}
            >
              <DropdownMenuLabel className="relative font-normal">
                <div className="flex flex-col space-y-1 p-2">
                  {user.name ? (
                    <motion.div
                      variants={{
                        closed: { opacity: 0, x: -20 },
                        open: {
                          opacity: 1,
                          x: 0,
                          transition: {
                            type: "spring",
                            stiffness: 400,
                            damping: 25,
                          },
                        },
                      }}
                    >
                      <p className="font-medium text-sm leading-none">
                        {user.name}
                      </p>
                    </motion.div>
                  ) : null}
                  <motion.div
                    variants={{
                      closed: { opacity: 0, x: -20 },
                      open: {
                        opacity: 1,
                        x: 0,
                        transition: {
                          type: "spring",
                          stiffness: 400,
                          damping: 25,
                          delay: 0.05,
                        },
                      },
                    }}
                  >
                    <p className="text-muted-foreground text-xs leading-none">
                      {user.email}
                    </p>
                  </motion.div>
                </div>
              </DropdownMenuLabel>
            </motion.div>

            <div className="h-px bg-border/10" />

            <div className="p-1">
              <MenuItem
                href={`/users/${user.username}`}
                icon={<UserIcon className="mr-2 size-4" />}
                label="Profile"
              />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="relative my-1 w-full cursor-pointer rounded-md transition-colors duration-200 hover:bg-primary/10 focus:bg-primary/10">
                  <Monitor className="mr-2 size-4" />
                  <span>Theme</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="animate-in cursor-pointer rounded-xl border border-border/50 bg-background/90 shadow-lg backdrop-blur-xl">
                    {[
                      { icon: Monitor, label: "System", value: "system" },
                      { icon: Sun, label: "Light", value: "light" },
                      { icon: Moon, label: "Dark", value: "dark" },
                    ].map(({ icon: Icon, label, value }) => (
                      <motion.div
                        key={value}
                        whileHover={{
                          backgroundColor: "rgba(var(--primary), 0.1)",
                          transition: { duration: 0.2 },
                        }}
                      >
                        <DropdownMenuItem
                          className="cursor-pointer pr-2 focus:bg-primary/10"
                          data-theme-value={value}
                          onClick={handleThemeSelect}
                        >
                          <Icon className="mr-2 size-4" />
                          <span>{label}</span>
                          {theme === value && (
                            <motion.div
                              animate={{ scale: 1, rotate: 0 }}
                              className="ml-auto pl-4"
                              initial={{ scale: 0, rotate: -90 }}
                              transition={{
                                type: "spring",
                                stiffness: 400,
                                damping: 17,
                              }}
                            >
                              <Check className="size-4" />
                            </motion.div>
                          )}
                        </DropdownMenuItem>
                      </motion.div>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <MenuItem
                href="/settings"
                icon={<Settings2Icon className="mr-2 size-4" />}
                label="Settings"
              />

              <div className="my-1 h-px bg-border/10" />

              <DropdownMenuSeparator />

              <motion.div
                transition={{ duration: 0.2 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <DropdownMenuItem
                  className="group cursor-pointer rounded-md text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 focus:text-red-500"
                  onClick={handleOpenDialog}
                >
                  <motion.div
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    whileHover={{ rotate: 15 }}
                  >
                    <LogOutIcon className="mr-2 size-4" />
                  </motion.div>
                  <span>Log out</span>
                </DropdownMenuItem>
              </motion.div>
            </div>
          </motion.div>
        </DropdownMenuContent>
      </DropdownMenu>

      <LogoutDialog
        onCloseAction={closeLogoutDialog}
        onLogoutAction={handleLogout}
        open={logoutDialogOpen}
      />
    </>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: any
const MenuItem = ({ icon, label, href }: any) => (
  <motion.div
    variants={{
      closed: { opacity: 0, x: -20 },
      open: {
        opacity: 1,
        x: 0,
        transition: {
          type: "spring",
          stiffness: 400,
          damping: 25,
        },
      },
    }}
  >
    <motion.div
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 17,
      }}
      whileHover={{ scale: 1.02, x: 4 }}
      whileTap={{ scale: 0.98 }}
    >
      <DropdownMenuItem
        asChild
        className="cursor-pointer rounded-md transition-colors duration-200 hover:bg-primary/10 focus:bg-primary/10"
      >
        <Link className="flex items-center" href={href}>
          <motion.div
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 17,
            }}
            whileHover={{ rotate: 10, scale: 1.1 }}
          >
            {icon}
          </motion.div>
          <span>{label}</span>
        </Link>
      </DropdownMenuItem>
    </motion.div>
  </motion.div>
);
