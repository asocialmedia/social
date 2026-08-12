import type { UserData } from "@asm/db";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import Image from "next/image";
import { cn, isGifUrl, supportsTransparency } from "@/lib/utils";

interface UserAvatarProps {
  avatarUrl?: string | null;
  className?: string;
  priority?: boolean;
  size?: number;
  user?: Pick<UserData, "avatarUrl"> | null;
}

export default function UserAvatar({
  user,
  avatarUrl: directAvatarUrl,
  size,
  className,
  priority = false,
}: UserAvatarProps) {
  const avatarUrl = user?.avatarUrl ?? directAvatarUrl;
  const resolvedSrc =
    typeof avatarUrl === "string" ? avatarUrl : avatarPlaceholder.src;
  const transparent = supportsTransparency(resolvedSrc);

  return (
    <Image
      alt="User avatar"
      className={cn(
        "avatar-ring aspect-square h-fit flex-none rounded-xl",
        "bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))]",
        transparent ? "object-contain" : "object-cover",
        className
      )}
      height={size ?? 48}
      priority={priority}
      src={resolvedSrc}
      unoptimized={isGifUrl(avatarUrl)}
      width={size ?? 48} // Don't optimize GIFs to keep animation
    />
  );
}
