import type { Metadata } from "next";

import ClientSignupPage from "@/app/(auth)/client/client-sign-up-page";

export const metadata: Metadata = {
  alternates: { canonical: "/signup" },
  title: "Sign Up",
};

export default function SignupPage() {
  return <ClientSignupPage />;
}
