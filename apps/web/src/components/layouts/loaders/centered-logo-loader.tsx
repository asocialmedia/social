import Image from "next/image";

export function CenteredLogoLoader({ size = 56 }: { size?: number }) {
  return (
    <div
      aria-label="Loading page"
      aria-live="polite"
      className="flex w-full items-center justify-center py-16"
      role="status"
    >
      <div
        className="relative h-[56px] w-[56px]"
        style={{ height: size, width: size }}
      >
        <Image
          alt=""
          fill
          priority
          sizes={`${size}px`}
          src="/asocialmedialogo.svg"
        />
      </div>
    </div>
  );
}
