"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

import Spinner3D from "@/components/layouts/feedback/spinner-3d";
import { cn } from "@/lib/utils";

export default function CommunitySectionLinkContent({
  children,
}: {
  children: ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          pending && "opacity-0"
        )}
      >
        {children}
      </span>
      {pending ? (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center"
          data-section-pending=""
        >
          <Spinner3D className="size-4" />
        </span>
      ) : null}
    </>
  );
}
