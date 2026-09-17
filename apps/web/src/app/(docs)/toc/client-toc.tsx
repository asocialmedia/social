"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Code2,
  FileCheck,
  Flame,
  Mail,
  Scale,
  Shield,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import ScrollUpButton from "@/components/layouts/scroll-up-button";
import { FossBanner } from "@/components/misc/foss-banner";

const SECTIONS = [
  { id: "principles", label: "Key Principles" },
  { id: "agreement", label: "1. Agreement to Terms" },
  { id: "eligibility", label: "2. Eligibility & Accounts" },
  { id: "content-ownership", label: "3. Content Ownership & Licenses" },
  { id: "acceptable-use", label: "4. Acceptable Use Policy" },
  { id: "aura-rules", label: "5. Aura & Platform Economics" },
  { id: "communities-moderation", label: "6. Communities & Moderation" },
  { id: "dmca-copyright", label: "7. DMCA & Copyright Policy" },
  { id: "foss-distinction", label: "8. Open Source vs Hosted Service" },
  { id: "third-party-links", label: "9. External Links & Integrations" },
  { id: "disclaimers", label: '10. Disclaimers ("AS IS")' },
  { id: "limitation-liability", label: "11. Limitation of Liability" },
  { id: "indemnification", label: "12. Indemnification" },
  { id: "termination", label: "13. Account Termination" },
  { id: "governing-law", label: "14. Governing Law & Contact" },
];

export default function TermsPage() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      setIsVisible(window.scrollY > 150);
    };

    window.addEventListener("scroll", toggleVisibility, { passive: true });
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  return (
    <div className="min-h-screen w-full px-4 py-8">
      {/* Top 3D Navigation Bar */}
      <div className="mx-auto mb-8 flex max-w-4xl items-center justify-between">
        <Link
          href="/"
          className="btn-3d-gray group inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-95"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Back to Feed
        </Link>

        <Link
          href="/privacy"
          className="btn-3d-gray group inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-95"
        >
          Privacy Policy
          <ArrowLeft className="h-4 w-4 rotate-180 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <main className="container mx-auto max-w-4xl px-4 py-4 md:px-0">
        {/* Document Header */}
        <header className="mb-10 space-y-3">
          <div className="flex items-center gap-3.5">
            <div className="orange-3d-surface flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-sm">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Terms and Conditions
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <span className="chip-3d text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                  Version 2.0
                </span>
                <span className="text-muted-foreground text-xs font-medium">
                  Effective Date: September 17, 2026
                </span>
              </div>
            </div>
          </div>
          <p className="text-muted-foreground text-base sm:text-lg">
            Welcome to <strong>asocialmedia</strong>. These Terms govern your
            access to and use of <code>asocialmedia.cc</code>, our APIs, mobile
            interfaces, and associated community services.
          </p>
        </header>

        {/* Quick Highlights / At A Glance 3D Cards */}
        <section
          id="principles"
          className="surface-3d mb-12 rounded-3xl! p-6 sm:p-8"
        >
          <div className="mb-5 flex items-center gap-2.5">
            <div className="chip-3d text-primary flex size-7 items-center justify-center rounded-lg">
              <Scale className="h-4 w-4" />
            </div>
            <h2 className="text-lg font-bold">Terms at a Glance</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d text-primary flex size-8 shrink-0 items-center justify-center rounded-xl">
                <FileCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">You Keep Your Copyright</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  You own the intellectual property in your posts and media. You
                  grant us only the rights necessary to host, distribute, and
                  display them.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl text-amber-500">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Zero Tolerance for Harm</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Harassment, illegal material, CSAM, hate speech, malware, and
                  doxxing result in immediate account termination and reporting.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d text-primary flex size-8 shrink-0 items-center justify-center rounded-xl">
                <Flame className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Fair Play &amp; Aura Integrity
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Do not bot, manipulate karma, create sockpuppet accounts, or
                  exploit the Aura reputation system.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d text-primary flex size-8 shrink-0 items-center justify-center rounded-xl">
                <Code2 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Open Source vs. Hosted</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Our codebase is free and open source. However, access to this
                  specific hosted instance is a revocable privilege governed by
                  these Terms.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Quick jump navigation (3D pills) */}
        <nav
          aria-label="Table of Contents"
          className="surface-3d mb-10 rounded-2xl! p-5"
        >
          <p className="text-foreground mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="bg-primary size-2 rounded-full" />
            Table of Contents
          </p>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                className="chip-3d pill-3d-hover text-foreground/80 hover:text-foreground cursor-pointer rounded-lg! px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
              >
                {sec.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Terms Body */}
        <article className="prose prose-neutral dark:prose-invert text-foreground/90 max-w-none space-y-10 leading-relaxed">
          {/* Section 1 */}
          <section id="agreement">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              1. Agreement to Terms
            </h2>
            <p>
              By accessing, browsing, or using the services provided at{" "}
              <strong>asocialmedia.cc</strong> (&quot;the Platform&quot;,
              &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you enter
              into a legally binding agreement and agree to comply with and be
              bound by these Terms and Conditions (&quot;Terms&quot;).
            </p>
            <p>
              If you do not agree with any part of these Terms, you must not
              access or use the Platform. These Terms should be read alongside
              our{" "}
              <Link
                className="text-primary font-medium hover:underline"
                href="/privacy"
              >
                Privacy Policy
              </Link>
              , which describes how we collect, store, and process your personal
              information.
            </p>
          </section>

          {/* Section 2 */}
          <section id="eligibility">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              2. Eligibility &amp; Account Security
            </h2>
            <h3 className="mt-4 text-lg font-semibold">2.1 Age Requirement</h3>
            <p>
              You must be at least <strong>13 years of age</strong> (or the
              minimum legal age required in your country to consent to the
              processing of your personal data) to create an account or use the
              Platform. If you are under 18, you represent that you have your
              parent or legal guardian&apos;s permission to use the Platform.
            </p>

            <h3 className="mt-4 text-lg font-semibold">
              2.2 Account Credentials &amp; Responsibilities
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                You must provide an accurate, valid email address and choose an
                appropriate username that does not impersonate another
                individual or violate registered trademarks.
              </li>
              <li>
                You are solely responsible for maintaining the confidentiality
                of your account authentication credentials and for all
                activities conducted through your account.
              </li>
              <li>
                You must immediately notify us at{" "}
                <Link
                  className="text-primary font-mono hover:underline"
                  href="mailto:hello@asocialmedia.cc"
                >
                  hello@asocialmedia.cc
                </Link>{" "}
                if you suspect unauthorized access or any security breach of
                your account.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section id="content-ownership">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              3. Content Ownership &amp; License Grants
            </h2>
            <h3 className="mt-4 text-lg font-semibold">
              3.1 You Retain Ownership
            </h3>
            <p>
              You retain all copyright, moral rights, and intellectual property
              rights in any text posts (&quot;eddies&quot;), videos
              (&quot;gusts&quot;), images, comments, or multimedia that you
              create and upload to the Platform. We do not claim ownership over
              your original content.
            </p>

            <h3 className="mt-4 text-lg font-semibold">
              3.2 License to asocialmedia
            </h3>
            <p>
              By posting or submitting content to public surfaces of the
              Platform, you grant asocialmedia a non-exclusive, worldwide,
              royalty-free, transferable license (with right to sub-license to
              our infrastructure service providers solely to operate the
              platform) to host, store, cache, reproduce, format, display,
              distribute, and syndicate your content in connection with
              providing the services.
            </p>
            <p>
              This license enables us to render your posts in feeds, generate
              thumbnails and previews, distribute sitemaps to web search
              engines, and display your content across devices.
            </p>

            <h3 className="mt-4 text-lg font-semibold">
              3.3 Public Content &amp; Deletion
            </h3>
            <p>
              Content posted on public feeds, public communities, or tagged
              discussions is visible to anyone on the internet, including search
              engine web crawlers. When you delete a post, we immediately remove
              it from public feeds, though cached copies or search engine
              indices may take standard propagation cycles to update.
            </p>
          </section>

          {/* Section 4 */}
          <section id="acceptable-use">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              4. Acceptable Use Policy (Code of Conduct)
            </h2>
            <p>
              To keep asocialmedia safe, cozy, and constructive, you agree not
              to engage in any of the following prohibited behaviors:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Illegal Content &amp; CSAM:</strong> You may not upload,
                share, or transmit any Child Sexual Abuse Material (CSAM) or
                child exploitation content. Any instance will result in
                immediate permanent account termination, IP ban, and reporting
                to the National Center for Missing &amp; Exploited Children
                (NCMEC) and relevant law enforcement authorities.
              </li>
              <li>
                <strong>Harassment &amp; Doxxing:</strong> You may not stalk,
                harass, bully, threaten, or publish non-consensual personal
                information (including real names, physical addresses, phone
                numbers, or intimate imagery) of any individual.
              </li>
              <li>
                <strong>Hate Speech &amp; Violence:</strong> You may not post
                content that promotes violence, terrorism, self-harm, or incites
                hatred against individuals or groups based on race, ethnicity,
                religion, disability, gender, gender identity, or sexual
                orientation.
              </li>
              <li>
                <strong>Malware &amp; Phishing:</strong> You may not transmit
                malicious code, trojans, viruses, deceptive phishing links, or
                engage in social engineering attacks.
              </li>
              <li>
                <strong>Spam &amp; Unauthorized Automation:</strong> You may not
                conduct automated spam campaigns, unsolicited mass direct
                messages, or deploy unauthorized autonomous bots that degrade
                system performance or disrupt feeds.
              </li>
              <li>
                <strong>Infrastructure Abuse:</strong> You may not probe, scan,
                or test the vulnerability of our systems without authorization,
                bypass rate limits, or execute Denial of Service (DoS/DDoS)
                attacks against the platform.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section id="aura-rules">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              5. Aura, Gamification &amp; Platform Economics
            </h2>
            <p>
              asocialmedia features a reputation and gamification system known
              as <strong>Aura</strong>. Aura is an internal utility metric used
              solely to reflect community trust, unlock community creation
              thresholds, and elevate quality discussions.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>No Monetary Value:</strong> Aura has no fiat currency
                equivalent, cannot be purchased, redeemed, exchanged for real
                currency, or transferred outside the Platform.
              </li>
              <li>
                <strong>Prohibition on Manipulation:</strong> You may not create
                multiple accounts (&quot;sockpuppets&quot;), enter into
                vote-trading rings, deploy bots, or exploit software defects to
                artificially inflate Aura.
              </li>
              <li>
                <strong>Adjustment Rights:</strong> We reserve the right to
                recalculate, adjust, cap, or revoke Aura balances obtained
                through fraudulent, manipulative, or abusive means.
              </li>
            </ul>
          </section>

          {/* Section 6 */}
          <section id="communities-moderation">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              6. Communities &amp; Community Moderation
            </h2>
            <p>
              Users may create and join interest-based Communities. When
              moderating or participating in a community:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Community creators and moderators may establish custom rules,
                provided those rules do not conflict with these platform Terms
                of Service.
              </li>
              <li>
                Moderators are volunteers and not agents or employees of
                asocialmedia.
              </li>
              <li>
                asocialmedia reserves the right, in its sole discretion, to
                reassign community ownership, appoint new moderators, or remove
                communities that violate platform standards or remain abandoned.
              </li>
            </ul>
          </section>

          {/* Section 7 */}
          <section id="dmca-copyright">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              7. Copyright &amp; DMCA Takedown Procedure
            </h2>
            <p>
              We respect the intellectual property rights of others and comply
              with the Digital Millennium Copyright Act (DMCA) and international
              copyright standards. If you believe your copyrighted work has been
              copied in a way that constitutes copyright infringement, please
              submit a formal notice containing:
            </p>
            <div className="surface-3d my-6 space-y-3 rounded-2xl! p-6">
              <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <FileCheck className="text-primary size-4" />
                Required Statutory Elements
              </p>
              <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
                <li>
                  A physical or electronic signature of a person authorized to
                  act on behalf of the copyright owner.
                </li>
                <li>
                  Identification of the copyrighted work claimed to have been
                  infringed.
                </li>
                <li>
                  Identification of the material that is claimed to be
                  infringing and the exact URL on <code>asocialmedia.cc</code>.
                </li>
                <li>
                  Your contact information, including address, telephone number,
                  and a valid email address.
                </li>
                <li>
                  A statement that you have a good faith belief that the
                  disputed use is not authorized by the copyright owner, its
                  agent, or the law.
                </li>
                <li>
                  A statement made under penalty of perjury that the information
                  in the notice is accurate and you are authorized to act.
                </li>
              </ol>
              <div className="pt-2">
                <Link
                  className="btn-3d-gray inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
                  href="mailto:hello@asocialmedia.cc?subject=DMCA%20Notice"
                >
                  <Mail className="size-3.5" />
                  Submit DMCA Notice to hello@asocialmedia.cc
                </Link>
              </div>
            </div>
          </section>

          {/* Section 8 */}
          <section id="foss-distinction">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              8. Open Source Software vs. Hosted Service
            </h2>
            <p>
              The source code underlying asocialmedia is released as Free and
              Open Source Software (FOSS) on{" "}
              <Link
                className="text-primary font-medium hover:underline"
                href="https://github.com/asocialmedia/social"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </Link>
              . Your rights to inspect, fork, modify, or self-host the source
              code are governed by the applicable open-source license.
            </p>
            <p>
              However, these Terms of Service govern your access to the{" "}
              <strong>
                hosted platform, production infrastructure, domain names, and
                APIs
              </strong>{" "}
              operated at <code>asocialmedia.cc</code>. The
              &quot;asocialmedia&quot; name, logo, and brand identity remain
              protected assets and may not be used to imply endorsement without
              prior written consent.
            </p>
          </section>

          {/* Section 9 */}
          <section id="third-party-links">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              9. External Links &amp; Third-Party Integrations
            </h2>
            <p>
              The Platform contains links to external websites and content
              aggregators (such as Hacker News story links and external embeds).
              We have no control over and assume no responsibility for the
              content, privacy policies, or practices of any third-party
              websites or services. You access third-party links at your own
              risk.
            </p>
          </section>

          {/* Section 10 */}
          <section id="disclaimers">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              10. Disclaimers: Provided &quot;AS IS&quot;
            </h2>
            <div className="surface-3d my-6 space-y-3 rounded-2xl! p-6">
              <span className="chip-3d rounded-md px-2.5 py-0.5 font-mono text-[11px] tracking-wider uppercase">
                Disclaimer of Warranties
              </span>
              <p className="text-muted-foreground text-sm leading-relaxed uppercase">
                THE PLATFORM AND ALL CONTENT, FEATURES, AND SERVICES ARE
                PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
                BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
                IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
                MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE,
                ACCURACY, OR NON-INFRINGEMENT.
              </p>
              <p className="text-muted-foreground text-sm">
                WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED,
                SECURE, OR ERROR-FREE, THAT DEFECTS WILL BE TIMELY CORRECTED, OR
                THAT SERVERS ARE FREE OF HARMFUL COMPONENTS.
              </p>
            </div>
          </section>

          {/* Section 11 */}
          <section id="limitation-liability">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              11. Limitation of Liability
            </h2>
            <div className="surface-3d my-6 space-y-3 rounded-2xl! p-6">
              <span className="chip-3d rounded-md px-2.5 py-0.5 font-mono text-[11px] tracking-wider uppercase">
                Limitation of Damages
              </span>
              <p className="text-muted-foreground text-sm leading-relaxed uppercase">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT
                SHALL ASOCIALMEDIA, ITS CONTRIBUTORS, MAINTAINERS, AFFILIATES,
                OR SERVICE PROVIDERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT
                LIMITED TO LOSS OF PROFITS, LOSS OF DATA, LOSS OF USE, GOODWILL,
                OR OTHER INTANGIBLE LOSSES RESULTING FROM:
              </p>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                <li>
                  YOUR ACCESS TO, USE OF, OR INABILITY TO ACCESS OR USE THE
                  PLATFORM;
                </li>
                <li>
                  ANY CONDUCT OR CONTENT OF ANY THIRD PARTY ON THE PLATFORM,
                  INCLUDING DEFAMATORY, OFFENSIVE, OR ILLEGAL CONDUCT;
                </li>
                <li>
                  UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR CONTENT OR
                  TRANSMISSIONS.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 12 */}
          <section id="indemnification">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              12. Indemnification
            </h2>
            <p>
              You agree to defend, indemnify, and hold harmless asocialmedia,
              its maintainers, and contributors from and against any claims,
              liabilities, damages, judgments, awards, losses, costs, expenses,
              or fees (including reasonable legal fees) arising out of or
              relating to your violation of these Terms or your use of the
              Platform, including your submitted content.
            </p>
          </section>

          {/* Section 13 */}
          <section id="termination">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              13. Account Termination &amp; Suspension
            </h2>
            <p>
              You may discontinue your use of the Platform and request account
              deletion at any time through your profile settings or by
              contacting us.
            </p>
            <p>
              We reserve the right to temporarily suspend, permanently ban, or
              terminate your account and access to the Platform at any time,
              without prior notice or liability, if you breach any provision of
              these Terms, engage in harmful or fraudulent activity, or if
              required by applicable law.
            </p>
          </section>

          {/* Section 14 */}
          <section id="governing-law">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              14. Governing Law &amp; Contact Information
            </h2>
            <p>
              These Terms shall be governed by and construed in accordance with
              the laws applicable to open-source community services, without
              giving effect to any choice of law or conflict of law principles.
              Prior to initiating formal dispute proceedings, you agree to
              attempt to resolve any dispute or claim informally by contacting
              our team.
            </p>
            <div className="surface-3d my-6 space-y-3 rounded-2xl! p-6">
              <p className="text-foreground flex items-center gap-2 font-semibold">
                <Mail className="text-primary h-4 w-4" />
                Contact the Legal &amp; Governance Team
              </p>
              <p className="text-muted-foreground text-sm">
                If you have questions, feedback, or legal inquiries regarding
                these Terms:
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  className="btn-3d-gray inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
                  href="mailto:hello@asocialmedia.cc"
                >
                  <Mail className="size-3.5" />
                  hello@asocialmedia.cc
                </Link>
                <Link
                  className="btn-3d-gray inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
                  href="/support"
                >
                  asocialmedia.cc/support
                </Link>
              </div>
            </div>
          </section>
        </article>

        {/* FOSS Banner Component */}
        <FossBanner className="mt-12" />

        {/* Closing Note (3D surface) */}
        <footer className="surface-3d text-muted-foreground mt-10 rounded-2xl! p-5 text-center text-xs">
          By using asocialmedia, you acknowledge that you have read, understood,
          and agreed to these Terms and Conditions in their entirety.
        </footer>
      </main>

      <ScrollUpButton isVisible={isVisible} />
    </div>
  );
}
