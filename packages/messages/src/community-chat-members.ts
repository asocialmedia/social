import type { CommunityChatMemberOption } from "./community-chat";

export function mergeCommunityChatMemberOptions(
  current: readonly CommunityChatMemberOption[],
  incoming: readonly CommunityChatMemberOption[]
): CommunityChatMemberOption[] {
  const members = new Map(current.map((member) => [member.id, member]));
  for (const member of incoming) {
    members.set(member.id, member);
  }
  return [...members.values()].slice(-100);
}
