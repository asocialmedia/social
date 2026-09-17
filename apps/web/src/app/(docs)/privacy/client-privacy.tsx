"use client";

import Link from "next/link";

import {
  DocKey,
  DocNote,
  DocPage,
  DocSection,
  DocTable,
} from "@/components/legal/doc-page";

const SECTIONS = [
  { id: "data-controller", label: "Data Controller & Scope" },
  { id: "data-collected", label: "Information We Collect" },
  { id: "how-we-use-data", label: "How We Use Your Information" },
  { id: "legal-bases", label: "Legal Bases for Processing" },
  { id: "cookies-storage", label: "Cookies & Local Storage" },
  { id: "subprocessors", label: "Service Providers" },
  { id: "data-retention", label: "Data Retention & Deletion" },
  { id: "your-rights", label: "Your Legal Rights" },
  { id: "security-safeguards", label: "Security Safeguards" },
  { id: "children-privacy", label: "Children's Privacy" },
  { id: "international-transfers", label: "International Transfers" },
  { id: "policy-updates-contact", label: "Updates & Contact" },
] as const;

const COMMITMENTS = [
  {
    body: "We never sell, rent, or trade your personal data. There are no behavioral ad pixels, no third-party marketing trackers, and no data brokers.",
    title: "No surveillance ad-tech",
  },
  {
    body: "You keep full ownership of every post, image, and video you submit, and you can edit or permanently delete it at any time.",
    title: "You own your content",
  },
  {
    body: "We collect only what authenticates your account, hosts your feed, and protects the service against abuse.",
    title: "Minimal footprint",
  },
  {
    body: "asocialmedia is free and open-source software. The code that handles your data is publicly inspectable on GitHub.",
    title: "Auditable by anyone",
  },
] as const;

export default function PrivacyPolicyPage() {
  return (
    <DocPage
      crossLink={{ href: "/toc", label: "Terms of Service" }}
      effectiveDate="17 September 2026"
      sections={SECTIONS}
      summary={
        <>
          <p className="doc-body">
            This Privacy Policy explains how <strong>asocialmedia</strong> (
            <code>asocialmedia.cc</code>) collects, processes, and protects your
            personal data. It is written to be read: the commitments below are
            the short version, and the numbered sections that follow are the
            precise one.
          </p>

          <dl className="surface-3d mt-6 grid gap-x-10 gap-y-6 rounded-2xl p-6 sm:grid-cols-2">
            {COMMITMENTS.map((item) => (
              <div key={item.title}>
                <dt className="text-foreground text-sm font-semibold">
                  {item.title}
                </dt>
                <dd className="doc-body mt-1.5">{item.body}</dd>
              </div>
            ))}
          </dl>
        </>
      }
      title="Privacy Policy"
      version="2.0"
    >
      <DocSection id="data-controller" title="Data Controller & Scope">
        <p>
          The data controller responsible for personal information processed
          through <strong>asocialmedia</strong> (
          <code>https://asocialmedia.cc</code>) is the asocialmedia project
          team.
        </p>
        <p>
          This Privacy Policy applies solely to the hosted platform at{" "}
          <code>asocialmedia.cc</code>, its official APIs, and associated web
          applications. If you choose to self-host an independent instance of
          the open-source software repository, the operator of that independent
          deployment acts as their own data controller, and this policy does not
          govern their independent operation.
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
      </DocSection>
      <DocSection id="data-collected" title="Information We Collect">
        <p>
          We categorize the information we collect into three categories:
          information you provide directly, information collected automatically
          for operational security, and information we strictly do not collect.
        </p>

        <h3 className="mt-4 text-lg font-semibold">
          A. Information You Voluntarily Provide
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account Credentials:</strong> Username, display name, email
            address, and an encrypted password hash. When registering via
            third-party OAuth providers (e.g., GitHub or Google), we receive
            your verified email, avatar, and provider ID.
          </li>
          <li>
            <strong>Profile Details:</strong> Bio, profile avatar, banner image,
            and optional links you choose to share on your public profile.
          </li>
          <li>
            <strong>Public Content:</strong> Posts (&quot;eddies&quot;), video
            posts (&quot;gusts&quot;), comments, replies, attachments, community
            posts, tags, and reactions.
          </li>
          <li>
            <strong>Direct Communications:</strong> Direct messages and support
            inquiries sent to our administrative team.
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
            <strong>Platform Metrics & Gamification Data:</strong> Reputation
            points (&quot;Aura&quot;), interaction counts, follower/following
            relationships, and notification history.
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
            We do <strong>not</strong> collect government IDs, biometric data,
            or sensitive racial/ethnic categories.
          </li>
          <li>
            We do <strong>not</strong> buy or acquire third-party data broker
            profiles.
          </li>
        </ul>
      </DocSection>
      <DocSection id="how-we-use-data" title="How We Use Your Information">
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
            <strong>Account & Security Notifications:</strong> Sending essential
            transactional communications such as verification emails, password
            reset links, and security alerts.
          </li>
          <li>
            <strong>Platform Safety & Abuse Prevention:</strong> Enforcing our
            Terms of Service, detecting bot networks, mitigating spam, and
            combating harassment or harmful behavior.
          </li>
          <li>
            <strong>Search Engine Discovery:</strong> Generating dynamic public
            sitemaps (<code>/sitemap.xml</code>) and notifying search engines
            (via IndexNow protocol) of newly published public posts so users can
            discover content across the web.
          </li>
        </ul>
      </DocSection>
      <DocSection
        id="legal-bases"
        title="Legal Bases for Processing (GDPR, UK GDPR & DPDP)"
      >
        <p>
          Under international data protection regulations including the EU
          General Data Protection Regulation (GDPR) and the Digital Personal
          Data Protection Act (DPDP), we process your data under the following
          legal grounds:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Performance of a Contract (GDPR Art. 6(1)(b)):</strong>{" "}
            Processing your account credentials and content is necessary to
            fulfill our Terms of Service agreement to provide the platform.
          </li>
          <li>
            <strong>Legitimate Interests (GDPR Art. 6(1)(f)):</strong> Operating
            a reliable, secure service; investigating platform abuse, fraud, or
            spam; maintaining technical infrastructure and server stability.
          </li>
          <li>
            <strong>Legal Obligation (GDPR Art. 6(1)(c)):</strong> Complying
            with enforceable legal orders, child protection statutes (such as
            combating CSAM), and regulatory requests.
          </li>
          <li>
            <strong>Consent (GDPR Art. 6(1)(a)):</strong> For optional profile
            fields or integrations where explicit consent is requested. You may
            withdraw consent at any time.
          </li>
        </ul>
      </DocSection>
      <DocSection id="cookies-storage" title="Cookies & Local Storage Policy">
        <p>
          We believe in a tracker-free internet. Our use of browser cookies and
          local storage is strictly limited to functional and security
          requirements:
        </p>
        <DocTable head={["Key", "Type", "Purpose", "Retention"]}>
          <tr>
            <td>
              <DocKey>session_token</DocKey>
            </td>
            <td className="text-foreground">Essential</td>
            <td>
              Maintains your authenticated session securely via Better Auth.
            </td>
            <td className="tabular-nums">Session / 30 days</td>
          </tr>
          <tr>
            <td>
              <DocKey>theme</DocKey>
            </td>
            <td className="text-foreground">Functional</td>
            <td>Remembers your dark or light theme preference.</td>
            <td className="tabular-nums">Persistent</td>
          </tr>
          <tr>
            <td>
              <DocKey>tab_preferences</DocKey>
            </td>
            <td className="text-foreground">Functional</td>
            <td>
              Remembers your last selected feed tab, such as Global or Trending.
            </td>
            <td className="tabular-nums">30 days</td>
          </tr>
        </DocTable>

        <DocNote title="No advertising or tracking cookies">
          <p>
            We do <strong>not</strong> deploy advertising cookies, cross-site
            tracking beacons, or third-party behavioral fingerprinting scripts.
          </p>
        </DocNote>
      </DocSection>
      <DocSection id="subprocessors" title="Service Providers & Subprocessors">
        <p>
          We collaborate only with trusted infrastructure providers who adhere
          to stringent security and privacy regulations:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cloud Compute & Edge Infrastructure:</strong> Hosts our
            application servers, databases, and SSL termination.
          </li>
          <li>
            <strong>S3-Compatible Object Storage:</strong> Stores user-uploaded
            image files, video clips, and avatars securely with encrypted
            storage at rest.
          </li>
          <li>
            <strong>Transactional Email Provider:</strong> Delivers verification
            codes, password reset requests, and platform receipts.
          </li>
          <li>
            <strong>Search Indexing Services (IndexNow / Sitemaps):</strong>{" "}
            Pings search engines (Bing, DuckDuckGo, Yandex) with public URLs
            when new public posts are published to ensure search
            discoverability.
          </li>
        </ul>
        <p>
          We do not sell, rent, or monetize your information to any third party
          under any circumstance.
        </p>
      </DocSection>
      <DocSection id="data-retention" title="Data Retention & Deletion">
        <p>
          We retain personal data only for as long as necessary to fulfill the
          purposes outlined in this policy:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Active Accounts:</strong> User profiles and content remain
            active until modified or deleted by the user.
          </li>
          <li>
            <strong>Deleted Content:</strong> Posts, comments, or media you
            delete are immediately removed from public view. Associated media
            records are purged from storage.
          </li>
          <li>
            <strong>Unattached Uploads:</strong> Media files uploaded but never
            attached to a published post are automatically purged within 24
            hours via automated garbage collection.
          </li>
          <li>
            <strong>Account Deletion:</strong> If you delete your account, all
            associated personal identifying information is permanently deleted
            or anonymized. Encrypted operational disaster recovery backups
            expire and overwrite within a rolling 30-day window.
          </li>
        </ul>
      </DocSection>
      <DocSection
        id="your-rights"
        title="Your Legal Rights (GDPR, CCPA/CPRA, DPDP)"
      >
        <p>
          Regardless of your geographic location, we respect your rights over
          your personal data:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Right to Access:</strong> You can request a complete copy of
            the personal data we hold about you.
          </li>
          <li>
            <strong>Right to Rectification:</strong> You may update or correct
            inaccurate personal information at any time via your account
            settings.
          </li>
          <li>
            <strong>
              Right to Erasure (&quot;Right to be Forgotten&quot;):
            </strong>{" "}
            You have the right to request the permanent deletion of your account
            and personal data.
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
      </DocSection>
      <DocSection
        id="security-safeguards"
        title="Security & Infrastructure Safeguards"
      >
        <p>
          We implement comprehensive technical and organizational measures to
          protect your data:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Transport Encryption:</strong> All data in transit is
            encrypted using modern TLS 1.3 cryptographic protocols with HSTS
            enforcement.
          </li>
          <li>
            <strong>Password Protection:</strong> Passwords are never stored in
            plaintext; they are hashed using salted cryptographic key derivation
            algorithms.
          </li>
          <li>
            <strong>Access Controls & Rate Limiting:</strong> Granular
            role-based access controls and automated IP-based rate limiting
            protect authentication and API routes against brute-force attacks.
          </li>
          <li>
            <strong>Media Validation:</strong> All file uploads undergo MIME
            type and integrity checks to prevent malicious file uploads.
          </li>
        </ul>
      </DocSection>
      <DocSection id="children-privacy" title="Children's Privacy">
        <p>
          asocialmedia is strictly intended for individuals aged{" "}
          <strong>13 years or older</strong> (or the applicable digital age of
          consent in your jurisdiction, such as 16 in select European member
          states).
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
      </DocSection>
      <DocSection
        id="international-transfers"
        title="International Data Transfers"
      >
        <p>
          Because asocialmedia operates globally, your information may be
          processed and stored on servers located outside of your country of
          residence. Where personal data is transferred across international
          borders, we ensure that appropriate safeguards (such as standard
          contractual clauses or equivalent legal adequacy mechanisms) are in
          place to maintain protection equivalent to applicable privacy laws.
        </p>
      </DocSection>
      <DocSection
        id="policy-updates-contact"
        title="Policy Updates & Contact Information"
      >
        <p>
          We may update this Privacy Policy from time to time to reflect
          technological advancements, legal updates, or changes in platform
          architecture. When material changes occur, we will update the
          &quot;Effective Date&quot; at the top of this document and provide
          notice via platform announcements or email.
        </p>
        <DocNote title="Contact the privacy team">
          <p>
            For questions, concerns, or requests regarding this Privacy Policy
            or your personal data, write to{" "}
            <Link href="mailto:hello@asocialmedia.cc">
              hello@asocialmedia.cc
            </Link>
            . Verified requests are answered within 30 days.
          </p>
          <p>
            Source, issues, and policy history live at{" "}
            <Link
              href="https://github.com/asocialmedia/social"
              rel="noopener noreferrer"
              target="_blank"
            >
              github.com/asocialmedia/social
            </Link>
            .
          </p>
        </DocNote>
      </DocSection>
    </DocPage>
  );
}
