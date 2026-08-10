"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { useMentionedUsers } from "@/hooks/use-mentioned-users";
import { cn, formatNumber } from "@/lib/utils";

interface MentionedUser extends UserData {
  _count: {
    mentions: number;
    posts: number;
    following: number;
    followers: number;
  };
}

const MentionedUsersBar = () => {
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const { mentionedUsers, isLoading } = useMentionedUsers();

  const handleRefresh = useCallback(() => {
    startTransition(() => {
      queryClient.invalidateQueries({ queryKey: ["mentionedUsers"] });
    });
  }, [queryClient]);

  const handleHoverEnd = useCallback(() => setHoveredUser(null), []);
  const handleHoverStart = useCallback((e: PointerEvent) => {
    const userId = (e.currentTarget as HTMLElement | null)?.getAttribute(
      "data-user-id"
    );
    if (userId) {
      setHoveredUser(userId);
    }
  }, []);

  if (!(mentionedUsers?.length || isLoading)) {
    return null;
  }

  return (
    <Card className="relative overflow-hidden border-blue-500/20 bg-blue-500/[0.02] shadow-xs backdrop-blur-sm">
      <CardContent className="p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <motion.div
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-full bg-blue-500/10 p-1"
              initial={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <AtSign className="h-3.5 w-3.5 text-blue-500" />
            </motion.div>
            <h2 className="font-semibold text-foreground text-sm">
              Most Mentioned
            </h2>
          </div>
          <Button
            className="h-6 w-6 hover:bg-blue-500/10"
            disabled={isPending || isLoading}
            onClick={handleRefresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 transition-all duration-300 ${
                isPending || isLoading
                  ? "animate-spin text-blue-500"
                  : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        <ul className="space-y-1.5">
          <AnimatePresence mode="popLayout">
            {mentionedUsers.map((user: MentionedUser, index) => (
              <motion.li
                animate={{ opacity: 1, y: 0 }}
                className="group relative"
                data-user-id={user.id}
                exit={{ opacity: 0, x: -10 }}
                initial={{ opacity: 0, y: 10 }}
                key={user.id}
                onHoverEnd={handleHoverEnd}
                onHoverStart={handleHoverStart}
                transition={{ delay: index * 0.05 }}
              >
                <Link
                  className={cn(
                    "relative block rounded-md p-2 transition-all duration-300",
                    "hover:bg-blue-500/5 group-hover:border-blue-500/30"
                  )}
                  href={`/users/${user.username}`}
                >
                  <AnimatePresence>
                    {hoveredUser === user.id && (
                      <motion.div
                        animate={{ opacity: 0.04, scale: 1 }}
                        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-md"
                        exit={{ opacity: 0, scale: 1.1 }}
                        initial={{ opacity: 0, scale: 0.9 }}
                      >
                        {user.avatarUrl ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Image
                              alt={user.username}
                              className="h-32 w-32 scale-125 rounded-full object-cover opacity-[0.15] blur-sm"
                              height={120}
                              src={user.avatarUrl}
                              width={120}
                            />
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-5 font-medium text-blue-500/50 text-xs">
                        #{index + 1}
                      </span>
                      {user.avatarUrl ? (
                        <div className="relative h-6 w-6 overflow-hidden rounded-full border border-blue-500/20">
                          <Image
                            alt={user.username}
                            className="object-cover"
                            fill
                            src={user.avatarUrl}
                          />
                        </div>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground text-sm transition-colors group-hover:text-blue-500">
                          @{user.username}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatNumber(user._count.mentions)}{" "}
                          {user._count.mentions === 1 ? "mention" : "mentions"}
                        </p>
                      </div>
                    </div>
                    <motion.div
                      animate={{
                        opacity: hoveredUser === user.id ? 1 : 0,
                        x: hoveredUser === user.id ? 0 : -4,
                      }}
                      className="text-blue-500 text-sm"
                      initial={false}
                    >
                      →
                    </motion.div>
                  </div>
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </CardContent>

      <AnimatePresence>
        {isPending || isLoading ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
};

export default MentionedUsersBar;
