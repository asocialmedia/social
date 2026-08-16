import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";

// Route-group fallback for the main app shell: shown instantly on client-side
// navigation while the target segment's RSC payload renders and streams, so
// page switches never freeze on the previous screen.
export default function MainLoading() {
  return <AppShellSkeleton />;
}
