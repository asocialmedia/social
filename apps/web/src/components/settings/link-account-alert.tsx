"use client";

import { accountLinkErrorMessage } from "@asm/auth/validation";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useToast } from "@/lib/gooey-toast";

import { AccountResolutionDialog } from "./account-resolution-dialog";

export default function LinkAccountAlert({
  linkedProviders,
}: {
  linkedProviders: readonly string[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const error =
      searchParams.get("error") || searchParams.get("account_error");
    const success =
      searchParams.get("account_success") || searchParams.get("success");

    if (error && error !== "account_collision") {
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
        description: errorMessages[error] || accountLinkErrorMessage(error),
        title: "Link Failed",
        variant: "destructive",
      });
    }

    if (success && !error && linkedProviders.includes(success)) {
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
  }, [searchParams, toast, linkedProviders]);

  const collisionId = searchParams.get("account_collision");
  if (searchParams.get("error") === "account_collision" && collisionId) {
    return (
      <AccountResolutionDialog
        id={collisionId}
        onClose={() => {
          const params = new URLSearchParams(searchParams.toString());
          for (const name of [
            "account_collision",
            "error",
            "error_description",
            "account_error",
          ]) {
            params.delete(name);
          }
          router.replace(`/settings?${params.toString()}`, { scroll: false });
        }}
      />
    );
  }
  return null;
}
