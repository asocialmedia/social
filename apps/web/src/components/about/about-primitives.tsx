import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { aboutPhotos } from "./about-content";

export type AboutStyle = CSSProperties & Record<`--${string}`, string | number>;

export function Rule() {
  return <span className="hairline" aria-hidden="true" data-reveal="rule" />;
}

export function Highlight({
  children,
  color = "lavender",
}: {
  children: ReactNode;
  color?: "orange" | "lavender" | "sage" | "paper";
}) {
  return (
    <mark
      className="highlight"
      data-reveal="mark"
      style={{ "--mark-color": `var(--about-${color})` } as AboutStyle}
    >
      {children}
    </mark>
  );
}

export function ActionLink({
  children,
  href,
  accent = false,
  className = "",
}: {
  children: ReactNode;
  href: string;
  accent?: boolean;
  className?: string;
}) {
  const variant = accent ? "accent-link" : "action-link";
  return (
    <Link className={`${variant} ${className}`} href={href}>
      <span className={`${variant}__label`}>{children}</span>
      <span
        className={accent ? "accent-link__icon" : "action-link__arrow"}
        aria-hidden="true"
      >
        {accent ? "+" : "→"}
      </span>
    </Link>
  );
}

export function Photo({
  children,
  photo,
  className = "",
  eager = false,
  sizes = "(max-width: 899px) 90vw, 50vw",
}: {
  children?: ReactNode;
  photo: keyof typeof aboutPhotos;
  className?: string;
  eager?: boolean;
  sizes?: string;
}) {
  const image = aboutPhotos[photo];
  return (
    <div className={`tinted-photo ${className}`}>
      <Image
        className="tinted-photo__image"
        src={image.src}
        alt={image.alt}
        width={1200}
        height={900}
        loading={eager ? "eager" : "lazy"}
        sizes={sizes}
      />
      {children}
    </div>
  );
}
