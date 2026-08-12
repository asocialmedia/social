import Image from "next/image";

export function CenteredLogoLoader({ size = 56 }: { size?: number }) {
  return (
    <div
      aria-label="Loading page"
      aria-live="polite"
      className="flex w-full items-center justify-center py-16"
      role="status"
    >
      <div className="animate-pulse">
        <Image
          alt=""
          className="opacity-80"
          height={size}
          priority
          src="/asocialmedialogo.svg"
          width={size}
        />
      </div>
    </div>
  );
}
