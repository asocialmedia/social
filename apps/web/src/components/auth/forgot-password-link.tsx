"use client";

import Link from "next/link";

export default function ForgotPasswordLink() {
  return (
    <Link
      className="text-muted-foreground hover:text-primary px-2 py-1 text-sm transition-colors duration-300"
      href="/reset-password"
    >
      Forgot your password?
    </Link>
  );
}
