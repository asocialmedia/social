import { Button } from "@asm/ui/shadui/button";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { motion } from "motion/react";

export function GithubIssueButton() {
  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Button
        asChild
        className="w-full gap-2 bg-background/50 backdrop-blur-sm"
        variant="outline"
      >
        <a
          href="https://github.com/asocialmedia/social/issues/new/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <GitHubLogoIcon className="h-4 w-4" />
          Report Issue on GitHub
        </a>
      </Button>
    </motion.div>
  );
}
