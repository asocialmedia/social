"use client";

import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useState } from "react";
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

  return (
    <>
      <Button
        className={cn(
          "bg-primary font-medium font-sofiaProSoftMed text-background",
          className
        )}
        onClick={() => setShowDialog(true)}
        variant="outline"
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
