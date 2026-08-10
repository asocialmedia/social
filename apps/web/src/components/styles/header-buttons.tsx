import { Button } from "@asm/ui/shadui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { motion } from "motion/react";
import Link from "next/link";
import type React from "react";

interface HeaderIconButtonProps {
  count?: number;
  href: string;
  icon: React.ReactNode;
  title: string;
}

export function HeaderIconButton({
  href,
  icon,
  count,
  title,
}: HeaderIconButtonProps) {
  return (
    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              asChild
              className="relative rounded-full bg-transparent p-2 text-muted-foreground transition-colors duration-200 hover:bg-background/60 hover:text-foreground"
              variant="ghost"
            >
              <Link className="block" href={href}>
                <div className="relative text-muted-foreground">
                  {icon}
                  {!!count && (
                    <motion.span
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground"
                      initial={{ scale: 0 }}
                    >
                      {count}
                    </motion.span>
                  )}
                </div>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{title}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  );
}
