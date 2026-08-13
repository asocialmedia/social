"use client";

import Link from "next/link";

export default function ForgotPasswordLink() {
  return (
    <Link
      className="px-2 py-1 text-muted-foreground text-sm transition-colors duration-300 hover:text-primary"
      href="/reset-password"
    >
      Forgot your password?
    </Link>
  );
}
