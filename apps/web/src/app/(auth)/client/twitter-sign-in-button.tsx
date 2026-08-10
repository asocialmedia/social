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

export default function TwitterSignInButton({
  disabled,
  loading,
  onStart,
  onEnd,
}: Props) {
  const handleTwitterSignIn = async () => {
    const base = process.env.NEXT_PUBLIC_URL || window.location.origin;
    try {
      onStart?.();
      await authClient.signIn.social({
        provider: "twitter",
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
      onClick={handleTwitterSignIn}
      variant="outline"
    >
      <div className="flex items-center justify-center py-6">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <TwitterIcon />
        )}
      </div>
    </Button>
  );
}

function TwitterIcon() {
  const gradientId = useId();
  const filterId = useId();

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: Twitter icon is purely decorative
    <svg
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#ffffff" }} />
          <stop offset="100%" style={{ stopColor: "#A8A8A8" }} />
        </linearGradient>
        <filter id={filterId}>
          <feGaussianBlur result="coloredBlur" stdDeviation="1" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        <path
          d="M13.479 10.479L21.78 1h-2.18l-7.217 8.255L6.775 1H1l8.51 12.37L1 23h2.18l7.615-8.697L16.725 23H22.5l-9.021-12.521zm-1.095 1.252l-.88-1.256L4.33 2.34h2.81l5.745 8.217.88 1.256 7.51 10.733h-2.81l-5.991-8.563z"
          fill={`url(#${gradientId})`}
        />
      </g>
    </svg>
  );
}
