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

export const HeaderIconButton = ({
  href,
  icon,
  count,
  title,
}: HeaderIconButtonProps) => (
  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Button
            asChild
            className="text-muted-foreground hover:bg-background/60 hover:text-foreground relative rounded-full bg-transparent p-2 transition-colors duration-200"
            variant="ghost"
          >
            <Link className="block" href={href}>
              <div className="text-muted-foreground relative">
                {icon}
                {!!count && (
                  <motion.span
                    animate={{ scale: 1 }}
                    className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium"
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
