import type { Metadata } from "next";
import { Suspense } from "react";

import ClientCamera from "@/components/camera/client-camera";

export const metadata: Metadata = {
  description: "Capture fleets and gusts with your camera.",
  title: "Camera",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-sm text-white/80">
          Warming up the camera…
        </div>
      }
    >
      <ClientCamera />
    </Suspense>
  );
}
