import type { Metadata } from "next";
import { Suspense } from "react";

import { ExternalPostPage } from "@/components/protocols/external-post-page";

// Remote reader URLs have no original ASM content in their server HTML.
export const metadata: Metadata = {
  description: "Read a Bluesky post and its discussion on asocialmedia.",
  robots: { follow: true, index: false },
  title: "Bluesky post",
};

export default function Page() {
  return (
    <Suspense>
      <ExternalPostPage />
    </Suspense>
  );
}
