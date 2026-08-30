import Link from "next/link";
import type React from "react";
import { LinkIt } from "react-linkify-it";

import UserLinkWithTooltip from "@/components/layouts/user-link-with-tooltip";
import { LinkBadge } from "@/components/posts/link-badge";

interface LinkifyProps {
  children: React.ReactNode;
}
const usernameRegex = /(?<username>@[a-zA-Z0-9_-]+)/;
const hashtagRegex = /(?<hashtag>#[a-zA-Z0-9]+)/;
const urlRegex = /(?<url>https?:\/\/[^\s]+)/;

export default function Linkify({ children }: LinkifyProps) {
  return (
    <LinkifyUsername>
      <LinkifyHashtag>
        <LinkifyUrl>{children}</LinkifyUrl>
      </LinkifyHashtag>
    </LinkifyUsername>
  );
}

function renderUrlBadge(match: string, key: number) {
  return <LinkBadge key={key} url={match} />;
}

const LinkifyUrl = ({ children }: LinkifyProps) => (
  <LinkIt component={renderUrlBadge} regex={urlRegex}>
    {children}
  </LinkIt>
);

function renderUsernameLink(match: string, key: number) {
  return (
    <UserLinkWithTooltip key={key} username={match.slice(1)}>
      {match}
    </UserLinkWithTooltip>
  );
}

function renderHashtagLink(match: string, key: number) {
  return (
    <Link
      className="text-primary hover:underline"
      href={`/hashtag/${match.slice(1)}`}
      key={key}
    >
      {match}
    </Link>
  );
}

const LinkifyUsername = ({ children }: LinkifyProps) => (
  <LinkIt component={renderUsernameLink} regex={usernameRegex}>
    {children}
  </LinkIt>
);

const LinkifyHashtag = ({ children }: LinkifyProps) => (
  <LinkIt component={renderHashtagLink} regex={hashtagRegex}>
    {children}
  </LinkIt>
);
