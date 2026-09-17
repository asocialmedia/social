"use client";

import Link from "next/link";

import { DocNote, DocPage, DocSection } from "@/components/legal/doc-page";

const SECTIONS = [
  { id: "agreement", label: "Agreement to Terms" },
  { id: "eligibility", label: "Eligibility & Accounts" },
  { id: "content-ownership", label: "Content Ownership & Licenses" },
  { id: "acceptable-use", label: "Acceptable Use Policy" },
  { id: "aura-rules", label: "Aura & Platform Economics" },
  { id: "communities-moderation", label: "Communities & Moderation" },
  { id: "dmca-copyright", label: "DMCA & Copyright" },
  { id: "foss-distinction", label: "Open Source vs Hosted Service" },
  { id: "third-party-links", label: "External Links & Integrations" },
  { id: "disclaimers", label: "Disclaimers" },
  { id: "limitation-liability", label: "Limitation of Liability" },
  { id: "indemnification", label: "Indemnification" },
  { id: "termination", label: "Account Termination" },
  { id: "governing-law", label: "Governing Law & Contact" },
] as const;

const HIGHLIGHTS = [
  {
    body: "You own the intellectual property in your posts and media. You grant us only the rights needed to host, distribute, and display them.",
    title: "You keep your copyright",
  },
  {
    body: "Harassment, illegal material, CSAM, hate speech, malware, and doxxing result in immediate termination and, where required, a report.",
    title: "Zero tolerance for harm",
  },
  {
    body: "No bots, no sockpuppets, no manipulating Aura. The reputation system only means something if it is earned honestly.",
    title: "Fair play",
  },
  {
    body: "The code is free and open source. Access to this specific hosted instance is a revocable privilege governed by these Terms.",
    title: "Open source, hosted service",
  },
] as const;

export default function TermsPage() {
  return (
    <DocPage
      crossLink={{ href: "/privacy", label: "Privacy Policy" }}
      effectiveDate="17 September 2026"
      sections={SECTIONS}
      summary={
        <>
          <p className="doc-body">
            These Terms govern your access to and use of{" "}
            <strong>asocialmedia</strong> (<code>asocialmedia.cc</code>), our
            APIs, and the community services built on them. By using the
            platform you agree to them, so the four points below are the short
            version and the numbered sections are the binding one.
          </p>

          <dl className="surface-3d mt-6 grid gap-x-10 gap-y-6 rounded-2xl p-6 sm:grid-cols-2">
            {HIGHLIGHTS.map((item) => (
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
      title="Terms of Service"
      version="2.0"
    >
      <DocSection id="agreement" title="Agreement to Terms">
        <p>
          By accessing, browsing, or using the services provided at{" "}
          <strong>asocialmedia.cc</strong> (&quot;the Platform&quot;,
          &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you enter into a
          legally binding agreement and agree to comply with and be bound by
          these Terms and Conditions (&quot;Terms&quot;).
        </p>
        <p>
          If you do not agree with any part of these Terms, you must not access
          or use the Platform. These Terms should be read alongside our{" "}
          <Link
            className="text-primary font-medium hover:underline"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          , which describes how we collect, store, and process your personal
          information.
        </p>
      </DocSection>
      <DocSection id="eligibility" title="Eligibility & Account Security">
        <h3 className="mt-4 text-lg font-semibold">2.1 Age Requirement</h3>
        <p>
          You must be at least <strong>13 years of age</strong> (or the minimum
          legal age required in your country to consent to the processing of
          your personal data) to create an account or use the Platform. If you
          are under 18, you represent that you have your parent or legal
          guardian&apos;s permission to use the Platform.
        </p>

        <h3 className="mt-4 text-lg font-semibold">
          2.2 Account Credentials &amp; Responsibilities
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            You must provide an accurate, valid email address and choose an
            appropriate username that does not impersonate another individual or
            violate registered trademarks.
          </li>
          <li>
            You are solely responsible for maintaining the confidentiality of
            your account authentication credentials and for all activities
            conducted through your account.
          </li>
          <li>
            You must immediately notify us at{" "}
            <Link
              className="text-primary font-mono hover:underline"
              href="mailto:hello@asocialmedia.cc"
            >
              hello@asocialmedia.cc
            </Link>{" "}
            if you suspect unauthorized access or any security breach of your
            account.
          </li>
        </ul>
      </DocSection>
      <DocSection
        id="content-ownership"
        title="Content Ownership & License Grants"
      >
        <h3 className="mt-4 text-lg font-semibold">3.1 You Retain Ownership</h3>
        <p>
          You retain all copyright, moral rights, and intellectual property
          rights in any text posts (&quot;eddies&quot;), videos
          (&quot;gusts&quot;), images, comments, or multimedia that you create
          and upload to the Platform. We do not claim ownership over your
          original content.
        </p>

        <h3 className="mt-4 text-lg font-semibold">
          3.2 License to asocialmedia
        </h3>
        <p>
          By posting or submitting content to public surfaces of the Platform,
          you grant asocialmedia a non-exclusive, worldwide, royalty-free,
          transferable license (with right to sub-license to our infrastructure
          service providers solely to operate the platform) to host, store,
          cache, reproduce, format, display, distribute, and syndicate your
          content in connection with providing the services.
        </p>
        <p>
          This license enables us to render your posts in feeds, generate
          thumbnails and previews, distribute sitemaps to web search engines,
          and display your content across devices.
        </p>

        <h3 className="mt-4 text-lg font-semibold">
          3.3 Public Content &amp; Deletion
        </h3>
        <p>
          Content posted on public feeds, public communities, or tagged
          discussions is visible to anyone on the internet, including search
          engine web crawlers. When you delete a post, we immediately remove it
          from public feeds, though cached copies or search engine indices may
          take standard propagation cycles to update.
        </p>
      </DocSection>
      <DocSection
        id="acceptable-use"
        title="Acceptable Use Policy (Code of Conduct)"
      >
        <p>
          To keep asocialmedia safe, cozy, and constructive, you agree not to
          engage in any of the following prohibited behaviors:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Illegal Content &amp; CSAM:</strong> You may not upload,
            share, or transmit any Child Sexual Abuse Material (CSAM) or child
            exploitation content. Any instance will result in immediate
            permanent account termination, IP ban, and reporting to the National
            Center for Missing &amp; Exploited Children (NCMEC) and relevant law
            enforcement authorities.
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
            conduct automated spam campaigns, unsolicited mass direct messages,
            or deploy unauthorized autonomous bots that degrade system
            performance or disrupt feeds.
          </li>
          <li>
            <strong>Infrastructure Abuse:</strong> You may not probe, scan, or
            test the vulnerability of our systems without authorization, bypass
            rate limits, or execute Denial of Service (DoS/DDoS) attacks against
            the platform.
          </li>
        </ul>
      </DocSection>
      <DocSection
        id="aura-rules"
        title="Aura, Gamification & Platform Economics"
      >
        <p>
          asocialmedia features a reputation and gamification system known as{" "}
          <strong>Aura</strong>. Aura is an internal utility metric used solely
          to reflect community trust, unlock community creation thresholds, and
          elevate quality discussions.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>No Monetary Value:</strong> Aura has no fiat currency
            equivalent, cannot be purchased, redeemed, exchanged for real
            currency, or transferred outside the Platform.
          </li>
          <li>
            <strong>Prohibition on Manipulation:</strong> You may not create
            multiple accounts (&quot;sockpuppets&quot;), enter into vote-trading
            rings, deploy bots, or exploit software defects to artificially
            inflate Aura.
          </li>
          <li>
            <strong>Adjustment Rights:</strong> We reserve the right to
            recalculate, adjust, cap, or revoke Aura balances obtained through
            fraudulent, manipulative, or abusive means.
          </li>
        </ul>
      </DocSection>
      <DocSection
        id="communities-moderation"
        title="Communities & Community Moderation"
      >
        <p>
          Users may create and join interest-based Communities. When moderating
          or participating in a community:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Community creators and moderators may establish custom rules,
            provided those rules do not conflict with these platform Terms of
            Service.
          </li>
          <li>
            Moderators are volunteers and not agents or employees of
            asocialmedia.
          </li>
          <li>
            asocialmedia reserves the right, in its sole discretion, to reassign
            community ownership, appoint new moderators, or remove communities
            that violate platform standards or remain abandoned.
          </li>
        </ul>
      </DocSection>
      <DocSection id="dmca-copyright" title="Copyright & DMCA Takedown">
        <p>
          We respect the intellectual property rights of others and comply with
          the Digital Millennium Copyright Act (DMCA) and international
          copyright standards. If you believe your copyrighted work has been
          copied in a way that constitutes copyright infringement, please submit
          a formal notice containing:
        </p>
        <DocNote title="Required Statutory Elements">
          <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
            <li>
              A physical or electronic signature of a person authorized to act
              on behalf of the copyright owner.
            </li>
            <li>
              Identification of the copyrighted work claimed to have been
              infringed.
            </li>
            <li>
              Identification of the material that is claimed to be infringing
              and the exact URL on <code>asocialmedia.cc</code>.
            </li>
            <li>
              Your contact information, including address, telephone number, and
              a valid email address.
            </li>
            <li>
              A statement that you have a good faith belief that the disputed
              use is not authorized by the copyright owner, its agent, or the
              law.
            </li>
            <li>
              A statement made under penalty of perjury that the information in
              the notice is accurate and you are authorized to act.
            </li>
          </ol>
          <p>
            Send notices to{" "}
            <Link href="mailto:hello@asocialmedia.cc?subject=DMCA%20Notice">
              hello@asocialmedia.cc
            </Link>
            .
          </p>
        </DocNote>
      </DocSection>
      <DocSection
        id="foss-distinction"
        title="Open Source Software vs. Hosted Service"
      >
        <p>
          The source code underlying asocialmedia is released as Free and Open
          Source Software (FOSS) on{" "}
          <Link
            className="text-primary font-medium hover:underline"
            href="https://github.com/asocialmedia/social"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
          . Your rights to inspect, fork, modify, or self-host the source code
          are governed by the applicable open-source license.
        </p>
        <p>
          However, these Terms of Service govern your access to the{" "}
          <strong>
            hosted platform, production infrastructure, domain names, and APIs
          </strong>{" "}
          operated at <code>asocialmedia.cc</code>. The &quot;asocialmedia&quot;
          name, logo, and brand identity remain protected assets and may not be
          used to imply endorsement without prior written consent.
        </p>
      </DocSection>
      <DocSection id="third-party-links" title="External Links & Integrations">
        <p>
          The Platform contains links to external websites and content
          aggregators (such as Hacker News story links and external embeds). We
          have no control over and assume no responsibility for the content,
          privacy policies, or practices of any third-party websites or
          services. You access third-party links at your own risk.
        </p>
      </DocSection>
      <DocSection id="disclaimers" title='Disclaimers: Provided "AS IS"'>
        <DocNote title="Disclaimer of Warranties">
          <p>
            The platform and all content, features, and services are provided on
            an &quot;as is&quot; and &quot;as available&quot; basis, without
            warranties of any kind, either express or implied, including but not
            limited to implied warranties of merchantability, fitness for a
            particular purpose, title, accuracy, or non-infringement.
          </p>
          <p>
            We do not warrant that the platform will be uninterrupted, secure,
            or error-free, that defects will be timely corrected, or that
            servers are free of harmful components.
          </p>
        </DocNote>
      </DocSection>
      <DocSection id="limitation-liability" title="Limitation of Liability">
        <DocNote title="Limitation of Damages">
          <p>
            To the maximum extent permitted by applicable law, in no event shall
            asocialmedia, its contributors, maintainers, affiliates, or service
            providers be liable for any indirect, incidental, special,
            consequential, or punitive damages, including but not limited to
            loss of profits, loss of data, loss of use, goodwill, or other
            intangible losses resulting from:
          </p>
          <ul>
            <li>
              Your access to, use of, or inability to access or use the
              platform;
            </li>
            <li>
              Any conduct or content of any third party on the platform,
              including defamatory, offensive, or illegal conduct;
            </li>
            <li>
              Unauthorized access, use, or alteration of your content or
              transmissions.
            </li>
          </ul>
        </DocNote>
      </DocSection>
      <DocSection id="indemnification" title="Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless asocialmedia, its
          maintainers, and contributors from and against any claims,
          liabilities, damages, judgments, awards, losses, costs, expenses, or
          fees (including reasonable legal fees) arising out of or relating to
          your violation of these Terms or your use of the Platform, including
          your submitted content.
        </p>
      </DocSection>
      <DocSection id="termination" title="Account Termination">
        <p>
          You may discontinue your use of the Platform and request account
          deletion at any time through your profile settings or by contacting
          us.
        </p>
        <p>
          We reserve the right to temporarily suspend, permanently ban, or
          terminate your account and access to the Platform at any time, without
          prior notice or liability, if you breach any provision of these Terms,
          engage in harmful or fraudulent activity, or if required by applicable
          law.
        </p>
      </DocSection>
      <DocSection id="governing-law" title="Governing Law & Contact">
        <p>
          These Terms shall be governed by and construed in accordance with the
          laws applicable to open-source community services, without giving
          effect to any choice of law or conflict of law principles. Prior to
          initiating formal dispute proceedings, you agree to attempt to resolve
          any dispute or claim informally by contacting our team.
        </p>
        <DocNote title="Contact the legal team">
          <p>
            For questions or legal inquiries about these Terms, write to{" "}
            <Link href="mailto:hello@asocialmedia.cc">
              hello@asocialmedia.cc
            </Link>
            , or reach us through{" "}
            <Link href="/support">asocialmedia.cc/support</Link>.
          </p>
          <p>
            By using asocialmedia you acknowledge that you have read and agreed
            to these Terms in their entirety.
          </p>
        </DocNote>
      </DocSection>
    </DocPage>
  );
}
