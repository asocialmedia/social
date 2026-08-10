"use client";

import { Button } from "@asm/ui/shadui/button";
import { Card } from "@asm/ui/shadui/card";
import { Checkbox } from "@asm/ui/shadui/checkbox";
import { Input } from "@asm/ui/shadui/input";
import { Label } from "@asm/ui/shadui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@asm/ui/shadui/select";
import { Textarea } from "@asm/ui/shadui/textarea";
import { AlertTriangle, UserCog, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { trpc } from "../trpc/client";
import type { User } from "../types/types";

interface UserUpdateModalProps {
  onCloseAction: () => void;
  onSuccessAction: () => void;
  user: User;
}

export default function UserUpdateModal({
  user,
  onCloseAction,
  onSuccessAction,
}: UserUpdateModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio || "");
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [role, setRole] = useState(user.role);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateUserMutation = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      onSuccessAction();
      onCloseAction();
    },
    onError: (mutationError) => {
      setError(mutationError.message || "Failed to update user");
      setIsSubmitting(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    updateUserMutation.mutate({
      userId: user.id,
      data: {
        displayName: displayName || undefined,
        bio: bio || undefined,
        emailVerified,
        role,
      },
    });
  };

  const hasChanges =
    displayName !== user.displayName ||
    bio !== (user.bio || "") ||
    emailVerified !== user.emailVerified ||
    role !== user.role;

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      onClick={onCloseAction}
    >
      <motion.div
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md"
        exit={{ scale: 0.95, opacity: 0 }}
        initial={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        transition={{ duration: 0.2 }}
      >
        <Card className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
                <UserCog className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">Update User</h2>
                <p className="text-muted-foreground text-sm">
                  @{user.username}
                </p>
              </div>
            </div>
            <Button
              className="h-8 w-8"
              onClick={onCloseAction}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
                value={displayName}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                onChange={(e) => setBio(e.target.value)}
                placeholder="Enter bio (optional)"
                rows={3}
                value={bio}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                onValueChange={(value: "user" | "admin") => setRole(value)}
                value={role}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                checked={emailVerified}
                id="emailVerified"
                onCheckedChange={(checked) =>
                  setEmailVerified(checked as boolean)
                }
              />
              <Label className="text-sm" htmlFor="emailVerified">
                Email Verified
              </Label>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                disabled={isSubmitting}
                onClick={onCloseAction}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isSubmitting || !hasChanges} type="submit">
                {isSubmitting ? "Updating..." : "Update User"}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>
    </motion.div>
  );
}
