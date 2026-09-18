import CommunityPageSkeleton from "@/components/layouts/skeletons/community-page-skeleton";

// Navigation fallback for the route. The page's own Suspense boundary renders
// the same skeleton, so the two are visually identical and the swap to live
// content never shifts the layout.
export default function Loading() {
  return <CommunityPageSkeleton />;
}
