import { FeedTabs } from "@/features/feed/components/feed-tabs";

import type { ProfileViewTab } from "../lib/profile-tab-memory";

const TABS = [
  { label: "Posts", value: "posts" },
  { label: "Gusts", value: "gusts" },
  { label: "Responses", value: "responses" },
  { label: "Eddies", value: "eddies" },
  { label: "Amplified", value: "amplified" },
  { label: "Media", value: "media" },
] as const satisfies readonly { label: string; value: ProfileViewTab }[];

export function ProfileTabs({
  active,
  onChange,
}: {
  active: ProfileViewTab;
  onChange: (tab: ProfileViewTab) => void;
}) {
  return <FeedTabs active={active} onChange={onChange} tabs={TABS} />;
}
