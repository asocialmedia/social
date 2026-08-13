import { GitPullRequest } from "lucide-react";
import Link from "next/link";
import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";

const ORANGE_TILE_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface FossBannerProps {
  className?: string;
}

export function FossBanner({ className }: FossBannerProps) {
  return (
    <div className={`${APPLE_CARD_CLASS} mt-8 ${className}`}>
      <div className="flex items-start gap-3 p-2">
        <div className={ORANGE_TILE_CLASS}>
          <GitPullRequest className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">Open Source Project</h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Asocialmedia is a Free and Open Source Software (FOSS) project. We
            welcome contributions and suggestions. Visit our{" "}
            <Link
              className="font-medium text-primary hover:underline"
              href="https://github.com/asocialmedia/social"
              rel="noopener noreferrer"
              target="_blank"
            >
              GitHub repository
            </Link>{" "}
            to contribute or provide feedback on our policies and documentation.
          </p>
        </div>
      </div>
    </div>
  );
}
