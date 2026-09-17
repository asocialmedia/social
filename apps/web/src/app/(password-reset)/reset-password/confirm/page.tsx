import type { Metadata } from "next";

import ConfirmResetForm from "@/components/auth/forms/confirm-reset-form";
import { GooeyToaster } from "@/components/auth/shell/gooey-toaster";

export const metadata: Metadata = {
  robots: {
    follow: true,
    index: false,
  },
  title: "Reset Your Password",
};

// This route deliberately lives outside the signed-out auth layout. A user
// who requested a reset from Settings must be able to finish it while signed
// in, especially after setting a first password for an OAuth-created account.
export default function ConfirmResetPage() {
  return (
    <>
      <ConfirmResetForm />
      <GooeyToaster />
    </>
  );
}
