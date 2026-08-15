import helpImage from "@assets/auth/signup-image.jpg";
import { GitPullRequest, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import SupportForm from "./support-form";

export const metadata: Metadata = {
  description:
    "Get help, report bugs, or share your suggestions with the asocialmedia team",
  title: "Support",
};

export default function SupportPage() {
  return (
    <div className="bg-background relative flex min-h-screen overflow-hidden">
      <div className="from-primary/5 via-background to-background/95 absolute inset-0 z-0 bg-gradient-to-br" />

      <div className="absolute left-20 hidden h-full items-center md:flex">
        <div className="relative">
          <h1 className="vertical-left text-3d absolute top-1/2 left-0 -translate-y-1/2 text-6xl font-bold tracking-wider whitespace-nowrap select-none xl:text-8xl 2xl:text-9xl">
            HELP
          </h1>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="border-border bg-card relative flex w-full max-w-5xl flex-col items-stretch overflow-hidden rounded-2xl border shadow-2xl lg:h-[520px] lg:flex-row">
          <div className="relative hidden lg:flex lg:w-2/5">
            <Image
              alt="Support illustration"
              className="object-cover brightness-[0.4]"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 40vw"
              src={helpImage}
            />
            <div className="from-primary/20 absolute inset-0 bg-gradient-to-b via-transparent to-black/60" />
            <div className="relative z-10 flex flex-col justify-center gap-5 overflow-y-auto px-8 py-8">
              <div className="border-border/80 rounded-xl border bg-[#1d1d1d]/90 p-5 backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-2 text-[#ff9500]">
                  <GitPullRequest className="h-5 w-5" />
                  <h3 className="font-semibold">Open Source Project</h3>
                </div>
                <p className="text-muted-foreground text-sm">
                  asocialmedia is a Free and Open Source Software (FOSS)
                  project. We welcome contributions and suggestions to improve
                  our platform. Visit our{" "}
                  <Link
                    className="font-medium text-[#ff9500] hover:underline"
                    href="https://github.com/asocialmedia/social"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    GitHub repository
                  </Link>{" "}
                  to contribute or provide feedback on our policies and
                  documentation.
                </p>
              </div>

              <div className="border-border/80 rounded-xl border bg-[#1d1d1d]/90 p-5 backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-2 text-[#ff9500]">
                  <ShieldAlert className="h-5 w-5" />
                  <h3 className="font-semibold">Privacy Notice</h3>
                </div>
                <p className="text-muted-foreground text-sm">
                  To prevent abuse and ensure service quality, we collect and
                  store certain information including browser details and
                  submission timestamps. This data is used solely for rate
                  limiting and system improvements.
                </p>
              </div>
            </div>
          </div>

          <div className="relative flex w-full flex-col justify-center overflow-y-auto px-6 py-8 sm:px-8 lg:w-3/5">
            <div className="mx-auto w-full max-w-sm">
              <h2 className="mb-2 text-center text-3xl font-bold text-[#ff9500] sm:text-4xl">
                How can we help?
              </h2>
              <p className="text-muted-foreground mb-6 text-center text-sm">
                We're here to help! Send us your questions, suggestions, or
                report any issues.
              </p>
              <SupportForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
