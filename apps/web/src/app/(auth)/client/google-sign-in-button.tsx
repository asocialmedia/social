import { Button } from "@asm/ui/shadui/button";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth";

interface Props {
  disabled?: boolean;
  loading?: boolean;
  onEnd?: () => void;
  onStart?: () => void;
}

export default function GoogleSignInButton({
  disabled,
  loading,
  onStart,
  onEnd,
}: Props) {
  const handleGoogleSignIn = async () => {
    const base = process.env.NEXT_PUBLIC_URL || window.location.origin;
    try {
      onStart?.();
      await authClient.signIn.social({
        callbackURL: `${base}/`,
        newUserCallbackURL: `${base}/`,
        provider: "google",
      });
    } catch (error) {
      // Reset before rethrowing so the callback runs on the failure path too
      // (replaces the previous `finally` clause).
      onEnd?.();
      throw error;
    }
    onEnd?.();
  };

  return (
    <Button
      className="btn-social h-auto w-full rounded-xl py-2.5 text-sm transition-all duration-300 hover:bg-transparent hover:text-inherit"
      disabled={disabled}
      onClick={handleGoogleSignIn}
      variant="ghost"
    >
      <div className="flex items-center justify-center gap-2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleIcon />
        )}
        <span className="font-medium">Continue with Google</span>
      </div>
    </Button>
  );
}

const GoogleIcon = () => (
  <svg
    className="h-4 w-4"
    height="1em"
    viewBox="0 0 256 262"
    width="1em"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
      fill="#4285f4"
    />
    <path
      d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
      fill="#34a853"
    />
    <path
      d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
      fill="#fbbc05"
    />
    <path
      d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
      fill="#eb4335"
    />
  </svg>
);
