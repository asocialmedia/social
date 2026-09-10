"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useToast } from "@/lib/gooey-toast";

export default function LinkAccountAlert() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const error =
      searchParams.get("account_error") || searchParams.get("error");
    const success =
      searchParams.get("account_success") || searchParams.get("success");

    if (error) {
      const errorMessages: Record<string, string> = {
        account_ownership_conflict:
          "That provider account is already linked to another user",
        already_linked: "This account is already linked to your account",
        cannot_unlink_no_email:
          "Cannot unlink: No email associated with account",
        cannot_unlink_no_password:
          "Cannot unlink: Need at least one authentication method",
        email_mismatch: "The account email doesn't match your account email",
        google_account_linked_other:
          "This Google account is already linked to another user",
        google_auth_failed: "Google authentication failed. Please try again",
        link_confirmation_required:
          "Confirm that you want to connect this sign-in method first",
        link_requires_password:
          "Add a password before connecting another sign-in method",
        link_requires_verified_email:
          "Add and verify an email address before connecting another sign-in method",
        provider_flow_failed:
          "The provider did not complete account linking. Please try again.",
        social_account_already_linked:
          "That provider account is already linked to another user",
        unauthorized: "You must be logged in to link accounts",
        unknown_error: "An unexpected error occurred. Please try again",
      };

      toast({
        description: errorMessages[error] || "An error occurred",
        title: "Link Failed",
        variant: "destructive",
      });
    }

    if (success) {
      const successMessages: Record<string, string> = {
        google: "Your Google account is now connected",
        google_linked: "Your Google account is now connected",
        google_unlinked: "Your Google account is no longer connected",
        reddit: "Your Reddit account is now connected",
      };

      toast({
        description: successMessages[success] || "All set!",
        title:
          success === "google_unlinked" ? "Account Unlinked" : "Account Linked",
      });
    }
  }, [searchParams, toast]);

  return null;
}
