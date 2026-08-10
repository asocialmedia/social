// Intentionally no font class applied here; root layout already sets fonts
import { getPageMap } from "nextra/page-map";
import { Layout, Navbar } from "nextra-theme-docs";
import "nextra-theme-docs/style.css";
import Image from "next/image";
import type { ReactNode } from "react";
import "./theme.css";

interface NextraThemeProps {
  children: ReactNode;
}

export default async function NextraTheme({ children }: NextraThemeProps) {
  const navbar = (
    <Navbar
      logo={
        <Image alt="Asocialmedia Logo" height={44} src="/zeph.png" width={44} />
      }
    />
  );

  return (
    <div className="asm-theme">
      <Layout
        docsRepositoryBase="https://github.com/asocialmedia/social/tree/main/apps/docs"
        navbar={navbar}
        pageMap={await getPageMap()}
        sidebar={{ autoCollapse: true }}
      >
        {children}
      </Layout>
    </div>
  );
}
