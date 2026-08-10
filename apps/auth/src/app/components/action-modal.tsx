"use client";

import { Button } from "@asm/ui/shadui/button";
import { Card } from "@asm/ui/shadui/card";
import { AlertCircle, Edit, Eye, UserCog, X } from "lucide-react";
import { motion } from "motion/react";
import type { ModalAction, User } from "../types/types";

interface ActionModalProps {
  action: ModalAction;
  onCancelAction: () => void;
  onConfirmAction: () => void;
  user: User;
}

export default function ActionModal({
  user,
  action,
  onConfirmAction,
  onCancelAction,
}: ActionModalProps) {
  const getModalConfig = () => {
    switch (action) {
      case "view":
        return {
          title: "User Details",
          description: `View detailed information for ${user.displayName}.`,
          icon: Eye,
          iconColor: "text-blue-600",
          iconBg: "bg-blue-600/10",
          confirmText: "Close",
          confirmVariant: "default" as const,
          confirmClass: "",
          showCancel: false,
        };
      case "edit":
        return {
          title: "Edit User",
          description: `Edit information for ${user.displayName}.`,
          icon: Edit,
          iconColor: "text-orange-600",
          iconBg: "bg-orange-600/10",
          confirmText: "Save Changes",
          confirmVariant: "default" as const,
          confirmClass: "",
        };
      case "update":
        return {
          title: "Update User",
          description: `Update role and verification status for ${user.displayName}.`,
          icon: UserCog,
          iconColor: "text-purple-600",
          iconBg: "bg-purple-600/10",
          confirmText: "Update User",
          confirmVariant: "default" as const,
          confirmClass: "",
        };
      default:
        return {
          title: "Unknown Action",
          description: "An unknown action was requested.",
          icon: AlertCircle,
          iconColor: "text-muted-foreground",
          iconBg: "bg-muted",
          confirmText: "Confirm",
          confirmVariant: "default" as const,
          confirmClass: "",
        };
    }
  };

  const config = getModalConfig();

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-labelledby="modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      onClick={onCancelAction}
      role="dialog"
      transition={{ duration: 0.15 }}
    >
      <motion.div
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        initial={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        <Card className="w-full max-w-md border-border bg-card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className={`rounded-md p-2.5 ${config.iconBg}`}>
              <config.icon className={`h-6 w-6 ${config.iconColor}`} />
            </div>
            <Button
              aria-label="Close modal"
              className="h-8 w-8 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              onClick={onCancelAction}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mb-6">
            <h2
              className="mb-2 font-semibold text-foreground text-xl"
              id="modal-title"
            >
              {config.title}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {config.description}
            </p>
          </div>

          <div className="flex justify-end gap-3">
            {config.showCancel !== false && (
              <Button
                className="border-border bg-transparent transition-colors duration-150 hover:bg-accent"
                onClick={onCancelAction}
                variant="outline"
              >
                Cancel
              </Button>
            )}
            <Button
              className={`transition-all duration-150 hover:scale-105 ${config.confirmClass || ""}`}
              onClick={onConfirmAction}
              variant={config.confirmVariant}
            >
              {config.confirmText}
            </Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
