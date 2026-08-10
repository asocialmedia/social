import { Button } from "@asm/ui/shadui/button";
import { Loader2 } from "lucide-react";
import { useId } from "react";
import { authClient } from "@/lib/auth";

interface Props {
  disabled?: boolean;
  loading?: boolean;
  onEnd?: () => void;
  onStart?: () => void;
}

export default function GithubSignInButton({
  disabled,
  loading,
  onStart,
  onEnd,
}: Props) {
  const handleGithubSignIn = async () => {
    const base = process.env.NEXT_PUBLIC_URL || window.location.origin;
    try {
      onStart?.();
      await authClient.signIn.social({
        provider: "github",
        callbackURL: `${base}/`,
        newUserCallbackURL: `${base}/`,
      });
    } finally {
      onEnd?.();
    }
  };

  return (
    <Button
      className="w-full border-0 bg-black py-6 text-white backdrop-blur-xs transition-all duration-300"
      disabled={disabled}
      onClick={handleGithubSignIn}
      variant="outline"
    >
      <div className="flex items-center justify-center py-6">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <GithubIcon />
        )}
      </div>
    </Button>
  );
}

function GithubIcon() {
  const gradientId = useId();

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: Github logo is purely decorative
    <svg
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#ffffff" }} />
          <stop offset="100%" style={{ stopColor: "#16161e" }} />
        </linearGradient>
      </defs>
      <path
        d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385c.6.105.825-.255.825-.57c0-.285-.015-1.23-.015-2.235c-3.015.555-3.795-.735-4.035-1.41c-.135-.345-.72-1.41-1.23-1.695c-.42-.225-1.02-.78-.015-.795c.945-.015 1.62.87 1.845 1.23c1.08 1.815 2.805 1.305 3.495.99c.105-.78.42-1.305.765-1.605c-2.67-.3-5.46-1.335-5.46-5.925c0-1.305.465-2.385 1.23-3.225c-.12-.3-.54-1.53.12-3.18c0 0 1.005-.315 3.3 1.23c.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23c.66 1.65.24 2.88.12 3.18c.765.84 1.23 1.905 1.23 3.225c0 4.605-2.805 5.625-5.475 5.925c.435.375.81 1.095.81 2.22c0 1.605-.015 2.895-.015 3.3c0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
