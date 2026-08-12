"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useCallback, useState } from "react";
import EditProfileDialog from "@/components/layouts/edit-profile-dialog";
import { cn } from "@/lib/utils";

interface EditProfileButtonProps {
  className?: string;
  user: UserData;
}

export default function EditProfileButton({
  user,
  className,
}: EditProfileButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const handleOpenDialog = useCallback(() => setShowDialog(true), []);

  return (
    <>
      <Button
        className={cn(
          "h-9 rounded-full border-0 font-semibold text-sm transition-all duration-200 active:translate-y-px",
          "bg-gradient-to-b from-[#e4e7ec] to-[#c6ccd5] text-[#1c1f26]",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06)]",
          "hover:brightness-105",
          "dark:from-[#8f96a3] dark:to-[#5c6370] dark:text-white",
          "dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
          className
        )}
        onClick={handleOpenDialog}
        variant="ghost"
      >
        Edit profile
      </Button>
      <EditProfileDialog
        onOpenChange={setShowDialog}
        open={showDialog}
        user={user}
      />
    </>
  );
}
