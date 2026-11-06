import { useSession } from "@/app/(main)/session-provider";
import {
  communitySectionScope,
  useCommunitySectionStore,
} from "@/store/community-section-store";

export function useCommunitySectionLinks(slug: string, channelId?: string) {
  const { user } = useSession();
  const scope = communitySectionScope(user?.id, slug);
  const location = useCommunitySectionStore((state) => state.locations[scope]);
  return {
    chatHref: channelId
      ? `/a/${slug}/chat/${channelId}`
      : (location?.chatHref ?? `/a/${slug}/chat`),
    postsHref: location?.postsHref ?? `/a/${slug}`,
  };
}
