import { Suspense } from "react";

import ProfileSkeleton from "@/components/layouts/skeletons/profile-skeleton";
import { ExternalProfilePage } from "@/components/protocols/external-profile-page";

export default function Page() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ExternalProfilePage />
    </Suspense>
  );
}
