"use client";

import type { TrendingTopic } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { LucideTrendingUp, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useState, useTransition } from "react";
import TrendingTopicsSkeleton from "@/components/layouts/skeletons/trending-topic-skeleton";
import { formatNumber } from "@/lib/utils";
import {
  getTrendingTopics,
  invalidateTrendingTopicsCache,
} from "./topic-actions";

const TrendingTopics: React.FC = () => {
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [hoveredTopic, setHoveredTopic] = useState<string | null>(null);

  const fetchTopics = async (invalidateCache = false) => {
    try {
      setError(null);
      const newTopics = invalidateCache
        ? await invalidateTrendingTopicsCache()
        : await getTrendingTopics();

      if (newTopics.length > 0) {
        startTransition(() => {
          setTopics(newTopics);
          setLastUpdated(new Date());
        });
      }
    } catch (err) {
      setError("Failed to load trending topics");
      console.error("Error fetching trending topics:", err);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: This effect runs frequently
  useEffect(() => {
    fetchTopics();
    const intervalId = setInterval(
      () => {
        fetchTopics();
      },
      10 * 60 * 1000
    );

    return () => clearInterval(intervalId);
  }, []);

  const handleRefresh = () => {
    fetchTopics(true);
  };

  const handleHoverEnd = useCallback(() => setHoveredTopic(null), []);
  const handleHoverStart = useCallback((e: PointerEvent) => {
    const hashtag = (e.currentTarget as HTMLElement | null)?.getAttribute(
      "data-hashtag"
    );
    if (hashtag) {
      setHoveredTopic(hashtag);
    }
  }, []);

  if (isPending) {
    return <TrendingTopicsSkeleton />;
  }

  if (error) {
    return (
      <Card className="bg-card/50 shadow-xs backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-2">
            <p className="text-red-500 text-sm">{error}</p>
            <Button
              disabled={isPending}
              onClick={handleRefresh}
              size="sm"
              variant="outline"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!topics.length) {
    return null;
  }

  return (
    <Card className="relative overflow-hidden border-rose-500/20 bg-gradient-to-br from-rose-500/[0.02] to-orange-500/[0.02] shadow-xs backdrop-blur-sm">
      <CardContent className="p-3">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <motion.div
              animate={{ rotate: 0, opacity: 1 }}
              className="rounded-lg bg-gradient-to-br from-rose-500/10 to-orange-500/10 p-1"
              initial={{ rotate: -20, opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <LucideTrendingUp className="h-3.5 w-3.5 text-rose-500" />
            </motion.div>
            <h2 className="font-semibold text-foreground text-sm">
              Trending Topics
            </h2>
          </div>
          <Button
            className="h-6 w-6 hover:bg-rose-500/10"
            disabled={isPending}
            onClick={handleRefresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 transition-all duration-300 ${
                isPending
                  ? "animate-spin text-rose-500"
                  : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        {/* Topics List */}
        <ul className="space-y-1.5">
          <AnimatePresence mode="popLayout">
            {topics.map(({ hashtag, count }, index) => (
              <motion.li
                animate={{ opacity: 1, y: 0 }}
                className="group relative"
                data-hashtag={hashtag}
                exit={{ opacity: 0, x: -10 }}
                initial={{ opacity: 0, y: 10 }}
                key={hashtag}
                onHoverEnd={handleHoverEnd}
                onHoverStart={handleHoverStart}
                transition={{ delay: index * 0.05 }}
              >
                <Link
                  className="relative block rounded-md p-2 transition-all duration-300 hover:bg-gradient-to-br hover:from-rose-500/5 hover:to-orange-500/5"
                  href={`/hashtag/${hashtag.slice(1)}`}
                >
                  {/* Background Hashtag */}
                  <AnimatePresence>
                    {hoveredTopic === hashtag && (
                      <motion.div
                        animate={{ opacity: 0.04, scale: 1 }}
                        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-md"
                        exit={{ opacity: 0, scale: 1.1 }}
                        initial={{ opacity: 0, scale: 0.9 }}
                      >
                        <div className="relative">
                          <span className="absolute inset-0 blur-xl">
                            <span className="bg-gradient-to-br from-rose-500 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
                              {hashtag}
                            </span>
                          </span>
                          <span className="bg-gradient-to-br from-rose-500 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
                            {hashtag}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex min-w-0 items-center">
                      <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-gradient-to-br from-rose-500/10 to-orange-500/10">
                        <span className="font-medium text-rose-500 text-xs">
                          {index + 1}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 px-2">
                        <p
                          className="truncate font-medium text-foreground text-sm transition-colors group-hover:text-rose-500"
                          title={hashtag}
                        >
                          {hashtag}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatNumber(count)} {count === 1 ? "post" : "posts"}
                        </p>
                      </div>
                    </div>
                    <motion.div
                      animate={{
                        opacity: hoveredTopic === hashtag ? 1 : 0,
                        x: hoveredTopic === hashtag ? 0 : -4,
                      }}
                      className="bg-gradient-to-br from-rose-500 to-orange-500 bg-clip-text font-bold text-sm text-transparent"
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

        {/* Last Updated */}
        <motion.p
          animate={{ opacity: 1 }}
          className="mt-2 text-[10px] text-muted-foreground"
          initial={{ opacity: 0 }}
        >
          Last updated: {lastUpdated.toLocaleTimeString()}
        </motion.p>
      </CardContent>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isPending ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <RefreshCw className="h-5 w-5 animate-spin text-rose-500" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
};

export default TrendingTopics;
