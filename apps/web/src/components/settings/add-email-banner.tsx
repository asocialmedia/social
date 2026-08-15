"use client";

import { MailWarning } from "lucide-react";
import Link from "next/link";

// Shown to users who signed up with Reddit (which never provides an email).
// Reddit-only accounts have no recovery address, so nudge them to add one via
// the email field in the account settings card.
const AddEmailBanner: React.FC = () => (
  <div className="reels-panel relative flex items-start gap-3 overflow-hidden rounded-2xl p-4">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff4500] to-[#ff2200] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,30,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
      <MailWarning className="size-4" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="font-medium">Add a recovery email</p>
      <p className="text-muted-foreground mt-0.5 text-sm">
        Reddit doesn&apos;t share your email, so this account has no recovery
        address. Add one so you can reset your password and receive account
        notifications.
      </p>
      <Link
        className="text-primary mt-2 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        href="/settings#settings-email"
      >
        Add email
      </Link>
    </div>
  </div>
);

export default AddEmailBanner;
