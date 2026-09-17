import Link from "next/link";

// The colophon at the foot of a right rail. Shared by the home rail and the
// community rail so the two cannot drift apart.
const FOOTER_LINKS = [
  { href: "/toc", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://x.com/parazeeknova", label: "Twitter" },
  { href: "https://github.com/asocialmedia/social", label: "Github" },
  { href: "/support", label: "Support" },
] as const;

export default function SidebarFooterLinks() {
  const year = new Date().getFullYear();
  return (
    <footer className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-xs">
      <span>© {year} asocialmedia</span>
      {FOOTER_LINKS.map(({ href, label }) => (
        <Link
          className="hover:text-foreground transition-colors"
          href={href}
          key={label}
          rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
          target={href.startsWith("http") ? "_blank" : undefined}
        >
          {label}
        </Link>
      ))}
    </footer>
  );
}
