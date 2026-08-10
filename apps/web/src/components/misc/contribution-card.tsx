"use client";

import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Button } from "@asm/ui/shadui/button";
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
      <div className="rounded-xl border bg-card p-2">
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
            <FaGithub className="h-5 w-5 text-muted-foreground transition-colors hover:text-primary" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 text-primary">
          <GitPullRequest className="h-5 w-5" />
          <h3 className="font-semibold">Contribute to Asocialmedia</h3>
        </div>

        <p className="text-muted-foreground text-sm">
          Help us make Asocialmedia better! We welcome all contributions.
        </p>

        <div className="space-y-2">
          <Link
            className="group flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-accent"
            href="https://github.com/asocialmedia/social"
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="flex items-center gap-2">
              <GitHubLogoIcon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              <span className="font-medium text-sm">Repository</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
          </Link>

          <Link
            className="group flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-accent"
            href="https://github.com/asocialmedia/social/issues"
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              <span className="font-medium text-sm">Issues</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
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
