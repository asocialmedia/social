import type { Metadata } from "next";
import { Suspense } from "react";

import ProfileSkeleton from "@/components/layouts/skeletons/profile-skeleton";
import { ExternalProfilePage } from "@/components/protocols/external-profile-page";

export const metadata: Metadata = {
  description: "Browse a Bluesky profile on asocialmedia.",
  robots: { follow: true, index: false },
  title: "Bluesky profile",
};

export default function Page() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ExternalProfilePage />
    </Suspense>
  );
}
