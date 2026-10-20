import { Suspense } from "react";

import { ExternalPostPage } from "@/components/protocols/external-post-page";

export default function Page() {
  return (
    <Suspense>
      <ExternalPostPage />
    </Suspense>
  );
}
