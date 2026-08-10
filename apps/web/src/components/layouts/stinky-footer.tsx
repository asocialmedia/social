import Link from "next/link";
import type React from "react";

const StickyFooter: React.FC = () => (
  <div className="hidden space-y-1 text-muted-foreground text-sm md:block">
    <div className="flex items-center justify-center space-x-2">
      <span className="font-sofiaProSoftBold">&copy; 2024</span>
      <span className="font-sofiaProSoftBold">Asocialmedia</span>
      <Link className="hover:text-foreground hover:underline" href="/toc">
        Terms
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/privacy">
        Privacy
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/soon">
        Feedback
      </Link>
    </div>
    <div className="flex justify-center space-x-2">
      <Link className="hover:text-foreground hover:underline" href="/soon">
        Status
      </Link>
      <a
        className="hover:text-foreground hover:underline"
        href="/soon"
        rel="noopener noreferrer"
        target="_blank"
      >
        Discord
      </a>
      <a
        className="hover:text-foreground hover:underline"
        href="https://github.com/asocialmedia/social"
        rel="noopener noreferrer"
        target="_blank"
      >
        Github
      </a>
      <a
        className="hover:text-foreground hover:underline"
        href="https://x.com/parazeeknova"
        rel="noopener noreferrer"
        target="_blank"
      >
        Twitter
      </a>
      <Link className="hover:text-foreground hover:underline" href="/soon">
        Rules
      </Link>
    </div>
    <div className="flex justify-center space-x-2">
      <Link className="hover:text-foreground hover:underline" href="/support">
        Support
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/soon">
        About
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/soon">
        More...
      </Link>
    </div>
  </div>
);

export default StickyFooter;
