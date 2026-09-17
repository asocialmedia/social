import { GitPullRequest } from "lucide-react";
import Link from "next/link";

const ORANGE_TILE_CLASS =
  "orange-3d-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";

interface FossBannerProps {
  className?: string;
}

export const FossBanner = ({ className = "" }: FossBannerProps) => (
  <div className={`surface-3d mt-8 rounded-2xl! p-4 ${className}`}>
    <div className="flex items-start gap-3.5">
      <div className={ORANGE_TILE_CLASS}>
        <GitPullRequest className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Open Source Project</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          asocialmedia is a Free and Open Source Software (FOSS) project. We
          welcome contributions and suggestions. Visit our{" "}
          <Link
            className="text-primary font-medium hover:underline"
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
