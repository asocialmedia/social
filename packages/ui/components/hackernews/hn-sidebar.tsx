"use client";

import {
  Activity,
  Briefcase,
  ChevronRight,
  Clock,
  HelpCircle,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { motion, type Variants } from "motion/react";
import type * as React from "react";
import { useCallback } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../shadui/button";
import { Card } from "../../shadui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../shadui/tooltip";
import { HNSearchInput } from "./hn-search-input";

export const SORT_OPTIONS = {
  SCORE: "score",
  TIME: "time",
  COMMENTS: "comments",
} as const;

export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS];

export const TAB_CONFIG = [
  { id: "all", label: "All Stories", icon: <Newspaper className="h-4 w-4" /> },
  { id: "story", label: "News", icon: <Activity className="h-4 w-4" /> },
  { id: "job", label: "Jobs", icon: <Briefcase className="h-4 w-4" /> },
  { id: "show", label: "Show HN", icon: <Search className="h-4 w-4" /> },
  { id: "ask", label: "Ask HN", icon: <HelpCircle className="h-4 w-4" /> },
];

interface HnSidebarProps {
  activeTab: string;
  isFetching: boolean;
  onRefreshAction: () => void;
  searchInput: string;
  setActiveTabAction: (value: string) => void;
  setSearchInputAction: (value: string) => void;
  setSortByAction: (value: SortOption) => void;
  sortBy: SortOption;
  totalPoints: number;
  totalStories: number;
}

const sidebarVariants: Variants = {
  hidden: { x: -50, opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 100, damping: 15 },
  },
};

export function HNSidebar({
  searchInput,
  setSearchInputAction,
  sortBy,
  setSortByAction,
  activeTab,
  setActiveTabAction,
  totalStories,
  totalPoints,
  isFetching,
  onRefreshAction,
}: HnSidebarProps) {
  const handleSortBySelect = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const value = e.currentTarget.dataset.value as SortOption;
      setSortByAction(value);
    },
    [setSortByAction]
  );

  const handleTabSelect = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setActiveTabAction(e.currentTarget.dataset.value ?? "");
    },
    [setActiveTabAction]
  );

  return (
    <motion.div
      animate="visible"
      className="h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-border/50 bg-background/95 backdrop-blur-xs md:h-[calc(100vh-2rem)]"
      initial="hidden"
      variants={sidebarVariants}
    >
      <div className="flex h-full flex-col">
        <div className="h-full overflow-y-auto rounded-lg border border-border/50 bg-background/95 backdrop-blur-sm">
          <div className="space-y-4">
            <div className="sticky top-0 z-20 bg-background/95 p-4 backdrop-blur-sm">
              <motion.div
                animate={{ scale: 1 }}
                className="flex items-center justify-between"
                initial={{ scale: 0.9 }}
              >
                <span className="bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text font-bold text-2xl text-transparent">
                  HackerNews
                </span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={onRefreshAction}
                        size="sm"
                        variant="ghost"
                      >
                        <RefreshCw
                          className={cn(
                            "h-4 w-4 transition-all",
                            isFetching ? "animate-spin text-orange-500" : ""
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh stories</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.div>

              <div className="mt-4">
                <HNSearchInput
                  className="backdrop-blur-sm"
                  onChangeAction={setSearchInputAction}
                  value={searchInput}
                />
              </div>
            </div>
          </div>

          <div className="px-4 pb-4">
            <Card className="mb-4 overflow-hidden bg-background/50 backdrop-blur-md">
              <div className="p-4">
                <h3 className="font-semibold">Sort By</h3>
                <div className="mt-2 space-y-1">
                  {Object.entries(SORT_OPTIONS).map(([key, value]) => (
                    <Button
                      className={cn(
                        "w-full justify-start",
                        sortBy === value
                          ? "bg-orange-500/10 text-orange-500"
                          : ""
                      )}
                      data-value={value}
                      key={key}
                      onClick={handleSortBySelect}
                      size="sm"
                      variant="ghost"
                    >
                      {key === "SCORE" && (
                        <TrendingUp className="mr-2 h-4 w-4" />
                      )}
                      {key === "TIME" && <Clock className="mr-2 h-4 w-4" />}
                      {key === "COMMENTS" && (
                        <MessageSquare className="mr-2 h-4 w-4" />
                      )}
                      {key.charAt(0) + key.slice(1).toLowerCase()}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="mb-4 overflow-hidden bg-background/50 backdrop-blur-md">
              <div className="p-4">
                <h3 className="mb-2 font-semibold">Filters</h3>
                <div className="space-y-1">
                  {TAB_CONFIG.map((tab) => (
                    <Button
                      className={cn(
                        "w-full justify-start",
                        activeTab === tab.id
                          ? "bg-orange-500/10 text-orange-500"
                          : ""
                      )}
                      data-value={tab.id}
                      key={tab.id}
                      onClick={handleTabSelect}
                      size="sm"
                      variant="ghost"
                    >
                      {tab.icon}
                      <span className="ml-2">{tab.label}</span>
                      {activeTab === tab.id && (
                        <ChevronRight className="ml-auto h-4 w-4" />
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden bg-background/50 backdrop-blur-md">
              <div className="p-4">
                <h3 className="mb-3 font-semibold">Statistics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-background/50 p-3 text-center">
                    <motion.div
                      animate={{ scale: 1 }}
                      className="font-bold text-2xl text-orange-500"
                      initial={{ scale: 0.5 }}
                    >
                      {totalStories.toLocaleString()}
                    </motion.div>
                    <div className="text-muted-foreground text-sm">Stories</div>
                  </div>
                  <div className="rounded-lg bg-background/50 p-3 text-center">
                    <motion.div
                      animate={{ scale: 1 }}
                      className="font-bold text-2xl text-orange-500"
                      initial={{ scale: 0.5 }}
                    >
                      {totalPoints.toLocaleString()}
                    </motion.div>
                    <div className="text-muted-foreground text-sm">Points</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
