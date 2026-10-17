import { GithubProjectCard } from "@/components/settings/settings-sidebar-cards";

interface FossBannerProps {
  className?: string;
}

// Re-export the redesigned GitHub open source project card as FossBanner for backward compatibility
export const FossBanner = ({ className = "" }: FossBannerProps) => (
  <GithubProjectCard className={className} />
);
