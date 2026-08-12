import Image from "next/image";
import type { ReactNode } from "react";

interface StatusScreenProps {
  action?: ReactNode;
  description: string;
  logo?: boolean;
  minHeight?: string;
  title: string;
}

export function StatusScreen({
  action,
  description,
  logo = true,
  minHeight = "min-h-screen",
  title,
}: StatusScreenProps) {
  return (
    <div
      className={`flex w-full ${minHeight} flex-col items-center justify-center gap-6 bg-background p-4 text-center`}
    >
      {logo ? (
        <Image
          alt=""
          className="opacity-80"
          height={64}
          src="/asocialmedialogo.svg"
          width={64}
        />
      ) : null}
      <div className="space-y-2 text-center">
        <h1 className="font-semibold text-foreground text-xl">{title}</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{description}</p>
      </div>
      {action ? <div className="flex justify-center">{action}</div> : null}
    </div>
  );
}
