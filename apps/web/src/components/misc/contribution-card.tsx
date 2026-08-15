"use client";

import { Button } from "@asm/ui/shadui/button";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { ChevronRight, Code2, GitPullRequest, Star } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";

interface ContributeCardProps {
  isCollapsed: boolean;
}

export default function ContributeCard({ isCollapsed }: ContributeCardProps) {
  if (isCollapsed) {
    return (
      <div className="bg-card rounded-xl border p-2">
        <Button
          asChild
          className="h-auto w-full p-2"
          size="icon"
          variant="ghost"
        >
          <Link
            href="https://github.com/asocialmedia/social"
            rel="noopener noreferrer"
            target="_blank"
          >
            <FaGithub className="text-muted-foreground hover:text-primary h-5 w-5 transition-colors" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="space-y-4 p-4">
        <div className="text-primary flex items-center gap-2">
          <GitPullRequest className="h-5 w-5" />
          <h3 className="font-semibold">Contribute to asocialmedia</h3>
        </div>

        <p className="text-muted-foreground text-sm">
          Help us make asocialmedia better! We welcome all contributions.
        </p>

        <div className="space-y-2">
          <Link
            className="group hover:bg-accent flex items-center justify-between rounded-lg p-2 transition-colors"
            href="https://github.com/asocialmedia/social"
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="flex items-center gap-2">
              <GitHubLogoIcon className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
              <span className="text-sm font-medium">Repository</span>
            </div>
            <ChevronRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
          </Link>

          <Link
            className="group hover:bg-accent flex items-center justify-between rounded-lg p-2 transition-colors"
            href="https://github.com/asocialmedia/social/issues"
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="flex items-center gap-2">
              <Code2 className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
              <span className="text-sm font-medium">Issues</span>
            </div>
            <ChevronRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
          </Link>
        </div>

        <motion.div
          animate={{ opacity: 1 }}
          className="border-t pt-2"
          initial={false}
        >
          <Button asChild className="w-full gap-2" size="sm" variant="outline">
            <Link
              href="https://github.com/asocialmedia/social"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Star className="h-4 w-4" />
              Star on GitHub
            </Link>
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
