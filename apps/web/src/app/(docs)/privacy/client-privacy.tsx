"use client";

import {
  ArrowLeft,
  Database,
  EyeOff,
  FileText,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import ScrollUpButton from "@/components/layouts/scroll-up-button";
import { FossBanner } from "@/components/misc/foss-banner";

const SECTIONS = [
  { id: "principles", label: "Core Principles" },
  { id: "data-controller", label: "1. Data Controller" },
  { id: "data-collected", label: "2. Information We Collect" },
  { id: "how-we-use-data", label: "3. How We Use Information" },
  { id: "legal-bases", label: "4. Legal Bases (GDPR / DPDP)" },
  { id: "cookies-storage", label: "5. Cookies & Local Storage" },
  { id: "subprocessors", label: "6. Service Providers & Subprocessors" },
  { id: "data-retention", label: "7. Data Retention & Deletion" },
  { id: "your-rights", label: "8. Your Legal Rights" },
  { id: "security-safeguards", label: "9. Security Safeguards" },
  { id: "children-privacy", label: "10. Children's Privacy" },
  { id: "international-transfers", label: "11. International Transfers" },
  { id: "policy-updates-contact", label: "12. Policy Updates & Contact" },
];

export default function PrivacyPolicyPage() {
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
          href="/toc"
          className="btn-3d-gray group inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-95"
        >
          Terms of Service
          <ArrowLeft className="h-4 w-4 rotate-180 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <main className="container mx-auto max-w-4xl px-4 py-4 md:px-0">
        {/* Document Header */}
        <header className="mb-10 space-y-3">
          <div className="flex items-center gap-3.5">
            <div className="orange-3d-surface flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-sm">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Privacy Policy
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
            This Privacy Policy explains how <strong>asocialmedia</strong> (
            <code>asocialmedia.cc</code>) collects, processes, and protects your
            personal data. We prioritize data minimization, transparency, and
            user autonomy.
          </p>
        </header>

        {/* Quick Summary / At A Glance 3D Cards */}
        <section
          id="principles"
          className="surface-3d mb-12 rounded-3xl! p-6 sm:p-8"
        >
          <div className="mb-5 flex items-center gap-2.5">
            <div className="chip-3d text-primary flex size-7 items-center justify-center rounded-lg">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <h2 className="text-lg font-bold">Privacy at a Glance</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl text-emerald-500">
                <EyeOff className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">No Surveillance Ad-Tech</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  We never sell, rent, or trade your personal data. We do not
                  embed behavioral ad pixels or third-party marketing trackers.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl text-emerald-500">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">You Own Your Content</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  You maintain full ownership of all posts, images, and videos
                  you submit. You can edit or permanently delete your content at
                  any time.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl text-emerald-500">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Minimal Data Footprint</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  We collect only the basic data required to authenticate your
                  account, host your feed, and safeguard the service against
                  abuse.
                </p>
              </div>
            </div>
            <div className="surface-3d flex items-start gap-3.5 rounded-2xl! p-4">
              <div className="chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl text-emerald-500">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Open Source Auditable</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Our codebase is free and open-source software (FOSS). Our data
                  handling logic is publicly inspectable on GitHub.
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

        {/* Policy Body */}
        <article className="prose prose-neutral dark:prose-invert text-foreground/90 max-w-none space-y-10 leading-relaxed">
          {/* Section 1 */}
          <section id="data-controller">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              1. Data Controller & Scope
            </h2>
            <p>
              The data controller responsible for personal information processed
              through <strong>asocialmedia</strong> (
              <code>https://asocialmedia.cc</code>) is the asocialmedia project
              team.
            </p>
            <p>
              This Privacy Policy applies solely to the hosted platform at{" "}
              <code>asocialmedia.cc</code>, its official APIs, and associated
              web applications. If you choose to self-host an independent
              instance of the open-source software repository, the operator of
              that independent deployment acts as their own data controller, and
              this policy does not govern their independent operation.
            </p>
            <p>
              For any privacy-related requests or inquiries, you may contact our
              privacy team at:{" "}
              <Link
                className="text-primary font-medium hover:underline"
                href="mailto:hello@asocialmedia.cc"
              >
                hello@asocialmedia.cc
              </Link>
              .
            </p>
          </section>

          {/* Section 2 */}
          <section id="data-collected">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              2. Information We Collect
            </h2>
            <p>
              We categorize the information we collect into three categories:
              information you provide directly, information collected
              automatically for operational security, and information we
              strictly do not collect.
            </p>

            <h3 className="mt-4 text-lg font-semibold">
              A. Information You Voluntarily Provide
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Account Credentials:</strong> Username, display name,
                email address, and an encrypted password hash. When registering
                via third-party OAuth providers (e.g., GitHub or Google), we
                receive your verified email, avatar, and provider ID.
              </li>
              <li>
                <strong>Profile Details:</strong> Bio, profile avatar, banner
                image, and optional links you choose to share on your public
                profile.
              </li>
              <li>
                <strong>Public Content:</strong> Posts (&quot;eddies&quot;),
                video posts (&quot;gusts&quot;), comments, replies, attachments,
                community posts, tags, and reactions.
              </li>
              <li>
                <strong>Direct Communications:</strong> Direct messages and
                support inquiries sent to our administrative team.
              </li>
            </ul>

            <h3 className="mt-4 text-lg font-semibold">
              B. Information Collected Automatically
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Technical & Security Telemetry:</strong> IP addresses,
                User-Agent strings, HTTP referrer, and request timestamps. IP
                addresses are used for rate-limiting, DDoS prevention, and fraud
                detection.
              </li>
              <li>
                <strong>Platform Metrics & Gamification Data:</strong>{" "}
                Reputation points (&quot;Aura&quot;), interaction counts,
                follower/following relationships, and notification history.
              </li>
            </ul>

            <h3 className="mt-4 text-lg font-semibold">
              C. Information We Never Collect
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                We do <strong>not</strong> collect financial, credit card, or
                banking details (asocialmedia is a free community platform).
              </li>
              <li>
                We do <strong>not</strong> collect precise GPS geolocation.
              </li>
              <li>
                We do <strong>not</strong> collect government IDs, biometric
                data, or sensitive racial/ethnic categories.
              </li>
              <li>
                We do <strong>not</strong> buy or acquire third-party data
                broker profiles.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section id="how-we-use-data">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              3. How We Use Your Information
            </h2>
            <p>
              We process your personal information exclusively for the following
              legitimate purposes:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Delivering Core Platform Services:</strong> Creating
                accounts, managing user authentication, rendering feeds, hosting
                multimedia uploads, and enabling community discussions.
              </li>
              <li>
                <strong>Account & Security Notifications:</strong> Sending
                essential transactional communications such as verification
                emails, password reset links, and security alerts.
              </li>
              <li>
                <strong>Platform Safety & Abuse Prevention:</strong> Enforcing
                our Terms of Service, detecting bot networks, mitigating spam,
                and combating harassment or harmful behavior.
              </li>
              <li>
                <strong>Search Engine Discovery:</strong> Generating dynamic
                public sitemaps (<code>/sitemap.xml</code>) and notifying search
                engines (via IndexNow protocol) of newly published public posts
                so users can discover content across the web.
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section id="legal-bases">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              4. Legal Bases for Processing (GDPR, UK GDPR & DPDP)
            </h2>
            <p>
              Under international data protection regulations including the EU
              General Data Protection Regulation (GDPR) and the Digital Personal
              Data Protection Act (DPDP), we process your data under the
              following legal grounds:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Performance of a Contract (GDPR Art. 6(1)(b)):</strong>{" "}
                Processing your account credentials and content is necessary to
                fulfill our Terms of Service agreement to provide the platform.
              </li>
              <li>
                <strong>Legitimate Interests (GDPR Art. 6(1)(f)):</strong>{" "}
                Operating a reliable, secure service; investigating platform
                abuse, fraud, or spam; maintaining technical infrastructure and
                server stability.
              </li>
              <li>
                <strong>Legal Obligation (GDPR Art. 6(1)(c)):</strong> Complying
                with enforceable legal orders, child protection statutes (such
                as combating CSAM), and regulatory requests.
              </li>
              <li>
                <strong>Consent (GDPR Art. 6(1)(a)):</strong> For optional
                profile fields or integrations where explicit consent is
                requested. You may withdraw consent at any time.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section id="cookies-storage">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              5. Cookies & Local Storage Policy
            </h2>
            <p>
              We believe in a tracker-free internet. Our use of browser cookies
              and local storage is strictly limited to functional and security
              requirements:
            </p>
            <div className="surface-3d my-6 overflow-x-auto rounded-2xl! p-5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-border/40 text-foreground border-b font-semibold">
                    <th className="pb-3">Cookie / Storage Key</th>
                    <th className="pb-3">Type</th>
                    <th className="pb-3">Purpose</th>
                    <th className="pb-3">Retention</th>
                  </tr>
                </thead>
                <tbody className="divide-border/20 text-muted-foreground divide-y text-xs">
                  <tr>
                    <td className="text-foreground py-3 font-mono font-semibold">
                      session_token
                    </td>
                    <td>
                      <span className="chip-3d rounded-md px-2 py-0.5 text-[11px] font-medium">
                        Essential
                      </span>
                    </td>
                    <td>
                      Maintains your authenticated session securely via Better
                      Auth.
                    </td>
                    <td>Session / 30 days</td>
                  </tr>
                  <tr>
                    <td className="text-foreground py-3 font-mono font-semibold">
                      theme
                    </td>
                    <td>
                      <span className="chip-3d rounded-md px-2 py-0.5 text-[11px] font-medium">
                        Functional
                      </span>
                    </td>
                    <td>Remembers your Dark / Light theme preference.</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td className="text-foreground py-3 font-mono font-semibold">
                      tab_preferences
                    </td>
                    <td>
                      <span className="chip-3d rounded-md px-2 py-0.5 text-[11px] font-medium">
                        Functional
                      </span>
                    </td>
                    <td>
                      Remembers your last selected feed tab (e.g., Global vs.
                      Trending).
                    </td>
                    <td>30 days</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground text-sm">
              We do <strong>not</strong> deploy any advertising cookies,
              cross-site tracking beacons, or third-party behavioral
              fingerprinting scripts.
            </p>
          </section>

          {/* Section 6 */}
          <section id="subprocessors">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              6. Service Providers & Subprocessors
            </h2>
            <p>
              We collaborate only with trusted infrastructure providers who
              adhere to stringent security and privacy regulations:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Cloud Compute & Edge Infrastructure:</strong> Hosts our
                application servers, databases, and SSL termination.
              </li>
              <li>
                <strong>S3-Compatible Object Storage:</strong> Stores
                user-uploaded image files, video clips, and avatars securely
                with encrypted storage at rest.
              </li>
              <li>
                <strong>Transactional Email Provider:</strong> Delivers
                verification codes, password reset requests, and platform
                receipts.
              </li>
              <li>
                <strong>Search Indexing Services (IndexNow / Sitemaps):</strong>{" "}
                Pings search engines (Bing, DuckDuckGo, Yandex) with public URLs
                when new public posts are published to ensure search
                discoverability.
              </li>
            </ul>
            <p>
              We do not sell, rent, or monetize your information to any third
              party under any circumstance.
            </p>
          </section>

          {/* Section 7 */}
          <section id="data-retention">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              7. Data Retention & Deletion
            </h2>
            <p>
              We retain personal data only for as long as necessary to fulfill
              the purposes outlined in this policy:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Active Accounts:</strong> User profiles and content
                remain active until modified or deleted by the user.
              </li>
              <li>
                <strong>Deleted Content:</strong> Posts, comments, or media you
                delete are immediately removed from public view. Associated
                media records are purged from storage.
              </li>
              <li>
                <strong>Unattached Uploads:</strong> Media files uploaded but
                never attached to a published post are automatically purged
                within 24 hours via automated garbage collection.
              </li>
              <li>
                <strong>Account Deletion:</strong> If you delete your account,
                all associated personal identifying information is permanently
                deleted or anonymized. Encrypted operational disaster recovery
                backups expire and overwrite within a rolling 30-day window.
              </li>
            </ul>
          </section>

          {/* Section 8 */}
          <section id="your-rights">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              8. Your Legal Rights (GDPR, CCPA/CPRA, DPDP)
            </h2>
            <p>
              Regardless of your geographic location, we respect your rights
              over your personal data:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Right to Access:</strong> You can request a complete
                copy of the personal data we hold about you.
              </li>
              <li>
                <strong>Right to Rectification:</strong> You may update or
                correct inaccurate personal information at any time via your
                account settings.
              </li>
              <li>
                <strong>
                  Right to Erasure (&quot;Right to be Forgotten&quot;):
                </strong>{" "}
                You have the right to request the permanent deletion of your
                account and personal data.
              </li>
              <li>
                <strong>Right to Data Portability:</strong> You may request an
                export of your content in a structured, machine-readable format
                (JSON).
              </li>
              <li>
                <strong>Right to Restrict or Object:</strong> You can object to
                specific processing activities based on legitimate interests.
              </li>
              <li>
                <strong>Right to Non-Discrimination:</strong> We will never deny
                services, degrade performance, or charge different rates for
                exercising any of your statutory privacy rights.
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <Link
                className="text-primary font-medium hover:underline"
                href="mailto:hello@asocialmedia.cc"
              >
                hello@asocialmedia.cc
              </Link>
              . We respond to all verified requests within 30 days.
            </p>
          </section>

          {/* Section 9 */}
          <section id="security-safeguards">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              9. Security & Infrastructure Safeguards
            </h2>
            <p>
              We implement comprehensive technical and organizational measures
              to protect your data:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Transport Encryption:</strong> All data in transit is
                encrypted using modern TLS 1.3 cryptographic protocols with HSTS
                enforcement.
              </li>
              <li>
                <strong>Password Protection:</strong> Passwords are never stored
                in plaintext; they are hashed using salted cryptographic key
                derivation algorithms.
              </li>
              <li>
                <strong>Access Controls & Rate Limiting:</strong> Granular
                role-based access controls and automated IP-based rate limiting
                protect authentication and API routes against brute-force
                attacks.
              </li>
              <li>
                <strong>Media Validation:</strong> All file uploads undergo MIME
                type and integrity checks to prevent malicious file uploads.
              </li>
            </ul>
          </section>

          {/* Section 10 */}
          <section id="children-privacy">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              10. Children&apos;s Privacy
            </h2>
            <p>
              asocialmedia is strictly intended for individuals aged{" "}
              <strong>13 years or older</strong> (or the applicable digital age
              of consent in your jurisdiction, such as 16 in select European
              member states).
            </p>
            <p>
              We do not knowingly collect or solicit personal information from
              children under 13. If we become aware that a child under 13 has
              created an account, we will immediately terminate the account and
              delete their personal data. Parents or guardians who believe their
              child has registered may notify us at{" "}
              <Link
                className="text-primary font-medium hover:underline"
                href="mailto:hello@asocialmedia.cc"
              >
                hello@asocialmedia.cc
              </Link>
              .
            </p>
          </section>

          {/* Section 11 */}
          <section id="international-transfers">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              11. International Data Transfers
            </h2>
            <p>
              Because asocialmedia operates globally, your information may be
              processed and stored on servers located outside of your country of
              residence. Where personal data is transferred across international
              borders, we ensure that appropriate safeguards (such as standard
              contractual clauses or equivalent legal adequacy mechanisms) are
              in place to maintain protection equivalent to applicable privacy
              laws.
            </p>
          </section>

          {/* Section 12 */}
          <section id="policy-updates-contact">
            <h2 className="border-border/50 border-b pb-2 text-2xl font-bold tracking-tight">
              12. Policy Updates & Contact Information
            </h2>
            <p>
              We may update this Privacy Policy from time to time to reflect
              technological advancements, legal updates, or changes in platform
              architecture. When material changes occur, we will update the
              &quot;Effective Date&quot; at the top of this document and provide
              notice via platform announcements or email.
            </p>
            <div className="surface-3d my-6 space-y-3 rounded-2xl! p-6">
              <p className="text-foreground flex items-center gap-2 font-semibold">
                <Mail className="text-primary h-4 w-4" />
                Contact the Privacy Team
              </p>
              <p className="text-muted-foreground text-sm">
                For questions, concerns, or requests regarding this Privacy
                Policy or your personal data:
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
                  href="https://github.com/asocialmedia/social"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/asocialmedia/social
                </Link>
              </div>
            </div>
          </section>
        </article>

        {/* FOSS Banner Component */}
        <FossBanner className="mt-12" />

        {/* Closing Note (3D surface) */}
        <footer className="surface-3d text-muted-foreground mt-10 rounded-2xl! p-5 text-center text-xs">
          Thank you for choosing asocialmedia. We are committed to building an
          open, transparent, and respectful digital town square.
        </footer>
      </main>

      <ScrollUpButton isVisible={isVisible} />
    </div>
  );
}
