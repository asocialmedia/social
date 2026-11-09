import { ProfileScreen } from "@/features/profile/components/profile-screen";

export default function UserProfileRoute() {
  return <ProfileScreen />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@/components/feedback/route-error-boundary";
