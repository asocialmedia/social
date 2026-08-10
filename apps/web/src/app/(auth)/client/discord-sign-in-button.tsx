import { Button } from "@asm/ui/shadui/button";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth";

interface Props {
  disabled?: boolean;
  loading?: boolean;
  onEnd?: () => void;
  onStart?: () => void;
}

export default function DiscordSignInButton({
  disabled,
  loading,
  onStart,
  onEnd,
}: Props) {
  const handleDiscordSignIn = async () => {
    const base = process.env.NEXT_PUBLIC_URL || window.location.origin;
    try {
      onStart?.();
      await authClient.signIn.social({
        provider: "discord",
        callbackURL: `${base}/`,
        newUserCallbackURL: `${base}/`,
      });
    } finally {
      onEnd?.();
    }
  };

  return (
    <Button
      className="w-full border-0 bg-[#5865F2] py-6 text-white backdrop-blur-xs transition-all duration-300 hover:bg-[#4752C4]"
      disabled={disabled}
      onClick={handleDiscordSignIn}
      variant="outline"
    >
      <div className="flex items-center justify-center py-6">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <DiscordIcon />
        )}
      </div>
    </Button>
  );
}

function DiscordIcon() {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: Discord icon is purely decorative
    <svg
      height="24"
      viewBox="0 0 127.14 96.36"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
        fill="white"
      />
    </svg>
  );
}
