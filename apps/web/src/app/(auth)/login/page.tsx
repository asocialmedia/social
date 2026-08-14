import type { Metadata } from "next";

import ClientLoginPage from "@/app/(auth)/client/client-login-page";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return <ClientLoginPage />;
}
