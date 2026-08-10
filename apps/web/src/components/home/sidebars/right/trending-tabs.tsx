"use client";

import { AnimatePresence, motion } from "motion/react";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import MentionedUsersBar from "./mentioned-users-bar";
import TagsBar from "./tags-bar";
import TrendingTopics from "./trending-topics";

const SWITCH_INTERVAL = 10_000;

const tabs = [
  { id: "topics", label: "Trending", icon: "📈" },
  { id: "tags", label: "Tags", icon: "#️⃣" },
  { id: "mentions", label: "Mentions", icon: "@️" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const TabContent = ({ activeTab }: { activeTab: TabId }) => (
  <AnimatePresence mode="wait">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: 10 }}
      key={activeTab}
      transition={{ duration: 0.2 }}
    >
      {(() => {
        switch (activeTab) {
          case "topics":
            return <TrendingTopics />;
          case "tags":
            return <TagsBar />;
          case "mentions":
            return <MentionedUsersBar />;
          default:
            return <TrendingTopics />;
        }
      })()}
    </motion.div>
  </AnimatePresence>
);

export function TrendingTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("topics");
  const [isAutoSwitching, setIsAutoSwitching] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isAutoSwitching) {
      setProgress(0);
      return;
    }

    let startTime = Date.now();
    let animationFrame: number;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = (elapsed / SWITCH_INTERVAL) * 100;

      if (newProgress >= 100) {
        setActiveTab((current) => {
          switch (current) {
            case "topics":
              return "tags";
            case "tags":
              return "mentions";
            case "mentions":
              return "topics";
            default:
              return "topics";
          }
        });

        startTime = Date.now();
        setProgress(0);
      } else {
        setProgress(newProgress);
        animationFrame = requestAnimationFrame(updateProgress);
      }
    };

    animationFrame = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [isAutoSwitching]);

  const handleTabClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const tabId = e.currentTarget.getAttribute("data-tab-id") as TabId | null;
    if (tabId) {
      setActiveTab(tabId);
      setIsAutoSwitching(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="relative flex items-center justify-center gap-6">
          {tabs.map((tab) => (
            // biome-ignore lint/a11y/useButtonType: off
            <button
              className={cn(
                "group relative px-2 py-1.5",
                "font-medium text-sm transition-colors",
                activeTab === tab.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-tab-id={tab.id}
              key={tab.id}
              onClick={handleTabClick}
            >
              <span className="relative z-10">{tab.label}</span>
              {activeTab === tab.id && (
                <motion.div
                  className="absolute inset-0 -z-10 rounded-md bg-primary/10"
                  layoutId="activeTab"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          ))}
        </div>

        {isAutoSwitching ? (
          <div className="absolute -bottom-2 left-0 mt-1 mb-1 h-[2px] w-full overflow-hidden rounded-full bg-muted/30">
            <motion.div
              animate={{
                width: `${progress}%`,
              }}
              className="h-full bg-primary/50"
              transition={{
                duration: 0,
                ease: "linear",
              }}
            />
          </div>
        ) : null}
      </div>

      <TabContent activeTab={activeTab} />
    </div>
  );
}
