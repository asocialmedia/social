"use client";

import { useQuery } from "@tanstack/react-query";
import {
  LogOutIcon,
  Monitor,
  Moon,
  Quote,
  Settings2Icon,
  Sun,
  UserIcon,
  X,
} from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback } from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import { getSecureImageUrl } from "@/lib/utils/image-url";

interface MobileUserMenuProps {
  isOpen: boolean;
  onCloseAction: () => void;
  onLogoutAction: () => void;
  setThemeAction: (theme: string) => void;
  theme?: string;
  user: {
    id: string;
    username?: string;
    email?: string;
    bio?: string;
    avatarUrl?: string | null;
    avatarKey?: string | null;
    displayName?: string;
  };
}

const menuVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 30,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: {
      duration: 0.2,
    },
  },
};

export function MobileUserMenu({
  isOpen,
  onCloseAction,
  user,
  theme,
  setThemeAction,
  onLogoutAction,
}: MobileUserMenuProps) {
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
          url: user.avatarUrl ? getSecureImageUrl(user.avatarUrl) : null,
          key: user.avatarKey,
        };
      }
    },
    initialData: {
      url: user.avatarUrl ? getSecureImageUrl(user.avatarUrl) : null,
      key: user.avatarKey,
    },
    staleTime: 1000 * 60 * 5,
  });

  const handleThemeClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const value = e.currentTarget.getAttribute("data-theme-value");
      if (value) {
        setThemeAction(value);
        onCloseAction();
      }
    },
    [onCloseAction, setThemeAction]
  );

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[200]">
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-background/90 backdrop-blur-lg"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={onCloseAction}
            transition={{ duration: 0.2 }}
          />
          <div className="fixed inset-0 z-[201] flex items-start justify-center p-4 pt-20">
            <div className="w-full max-w-md">
              <motion.div
                animate="visible"
                className="w-full"
                exit="exit"
                initial="hidden"
                variants={menuVariants}
              >
                <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/100 p-6 shadow-lg backdrop-blur-xl">
                  <motion.button
                    className="absolute top-4 right-4 rounded-full p-2 text-muted-foreground hover:bg-primary/10"
                    onClick={onCloseAction}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <X className="size-6" />
                  </motion.button>

                  <div className="mt-4 flex flex-col items-center space-y-4">
                    <motion.div
                      className="relative"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 opacity-75 blur-md" />
                      <Link
                        href={`/users/${user.username || user.id}`}
                        onClick={onCloseAction}
                      >
                        <UserAvatar
                          avatarUrl={avatarData?.url}
                          className="relative border-4 border-background shadow-xl"
                          priority
                          size={100}
                        />
                      </Link>
                    </motion.div>
                    <div className="text-center">
                      <h3 className="font-medium text-lg">
                        {user.displayName}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {user.username ? `@${user.username}` : user.email}
                      </p>
                      {user.bio ? (
                        <div className="mt-2 flex items-center justify-center gap-1 text-muted-foreground/60">
                          <Quote className="size-4" />
                          <p className="text-sm italic">{user.bio}</p>
                          <Quote className="size-4" />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <motion.div
                    className="mt-6 space-y-2"
                    variants={{
                      visible: {
                        transition: {
                          staggerChildren: 0.05,
                        },
                      },
                    }}
                  >
                    <MobileMenuItem
                      href={`/users/${user.username || user.id}`}
                      icon={<UserIcon className="size-5" />}
                      label="Profile"
                      onClick={onCloseAction}
                    />

                    <MobileMenuItem
                      href="/settings"
                      icon={<Settings2Icon className="size-5" />}
                      label="Settings"
                      onClick={onCloseAction}
                    />

                    <div className="rounded-lg border border-border/50 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Monitor className="size-5" />
                        <span>Theme</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { icon: Sun, label: "Light", value: "light" },
                          { icon: Moon, label: "Dark", value: "dark" },
                          { icon: Monitor, label: "System", value: "system" },
                        ].map(({ icon: Icon, label, value }) => (
                          <motion.button
                            className={`flex flex-col items-center gap-1 rounded-lg p-3 transition-colors ${
                              theme === value
                                ? "bg-primary/20 text-primary"
                                : "hover:bg-primary/10"
                            }`}
                            data-theme-value={value}
                            key={value}
                            onClick={handleThemeClick}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            <Icon className="size-5" />
                            <span className="text-xs">{label}</span>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    <motion.button
                      className="w-full rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-500 transition-colors hover:bg-red-500/20"
                      onClick={onLogoutAction}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <LogOutIcon className="size-5" />
                        <span>Log out</span>
                      </div>
                    </motion.button>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

interface MobileMenuItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}

function MobileMenuItem({ icon, label, href, onClick }: MobileMenuItemProps) {
  return (
    <Link href={href} onClick={onClick}>
      <motion.div
        className="flex items-center gap-2 rounded-lg border border-border/50 p-3 transition-colors hover:bg-primary/10"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {icon}
        <span>{label}</span>
      </motion.div>
    </Link>
  );
}
