import CommunitiesPageSkeleton from "@/components/layouts/skeletons/communities-page-skeleton";

// Navigation fallback for the route. The client component blocks its own first
// paint on the same skeleton, so the two are visually identical and the swap
// never shifts the layout.
export default function Loading() {
  return <CommunitiesPageSkeleton />;
}
