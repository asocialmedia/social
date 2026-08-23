"use client";

import type { PrivateUserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useCallback, useEffect, useState } from "react";

import EditProfileDialog from "@/components/layouts/edit-profile-dialog";
import { cn } from "@/lib/utils";

// While this flag is set the dialog reopens after a page refresh, so an
// in-progress edit survives an accidental reload.
const OPEN_FLAG_KEY = "edit-profile-dialog-open";

interface EditProfileButtonProps {
  className?: string;
  user: PrivateUserData;
}

export default function EditProfileButton({
  user,
  className,
}: EditProfileButtonProps) {
  const [showDialog, setShowDialog] = useState(false);

  // Restore an editing session interrupted by a refresh.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(OPEN_FLAG_KEY);
      if (stored === "1") {
        // Deferred one tick so the restore isn't a synchronous setState
        // inside the effect body.
        queueMicrotask(() => setShowDialog(true));
      }
    } catch {
      // Storage unavailable (privacy mode): the dialog just stays closed.
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setShowDialog(open);
    try {
      if (open) {
        sessionStorage.setItem(OPEN_FLAG_KEY, "1");
      } else {
        sessionStorage.removeItem(OPEN_FLAG_KEY);
      }
    } catch {
      // Ignore storage failures; closing still works.
    }
  }, []);

  return (
    <>
      <Button
        className={cn(
          "h-9 rounded-full border-0 text-sm font-semibold transition-all duration-200 active:translate-y-px",
          "bg-gradient-to-b from-[#e4e7ec] to-[#c6ccd5] text-[#1c1f26]",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06)]",
          "hover:brightness-105",
          "dark:from-[#8f96a3] dark:to-[#5c6370] dark:text-white",
          "dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
          className
        )}
        onClick={() => handleOpenChange(true)}
        variant="ghost"
      >
        Edit profile
      </Button>
      <EditProfileDialog
        onOpenChange={handleOpenChange}
        open={showDialog}
        user={user}
      />
    </>
  );
}
