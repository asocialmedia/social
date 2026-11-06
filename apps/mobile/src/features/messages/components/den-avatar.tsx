import { Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { orderedCopy } from "@/lib/format/ordered-copy";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MessageImage } from "./messages-primitives";

export function DenAvatar({
  conversation,
  size = 40,
}: {
  conversation: MessageConversationData;
  size?: number;
}) {
  const { theme } = useAppTheme();
  if (conversation.avatarMediaId) {
    return (
      <View
        style={{
          borderRadius: Math.round(size * 0.3),
          height: size,
          overflow: "hidden",
          width: size,
        }}
      >
        <MessageImage
          source={`${getApiBaseUrl()}/api/media/${conversation.avatarMediaId}/v/sm-webp.webp`}
          style={{ height: size, width: size }}
        />
      </View>
    );
  }
  const members = orderedCopy(
    conversation.members.filter((member) => !member.leftAt),
    (left, right) =>
      Number(right.role === "OWNER") - Number(left.role === "OWNER")
  );
  if (members.length < 2) {
    return (
      <UserAvatar
        size={size}
        url={members[0]?.user.avatarUrl}
        userId={conversation.id}
      />
    );
  }
  const faces = members.slice(0, 4);
  const count = faces.length;
  const diameter = size * (count === 2 ? 0.7 : 0.55);
  let slots = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  if (count === 2) {
    slots = [
      [0.35, 0.35],
      [0.65, 0.65],
    ];
  }
  if (count === 3) {
    slots = [
      [0.5, 0.3],
      [0.28, 0.68],
      [0.72, 0.68],
    ];
  }
  return (
    <View
      style={{
        backgroundColor: theme.cardBg,
        borderRadius: Math.round(size * 0.3),
        height: size,
        width: size,
      }}
    >
      {faces.map((member, index) => (
        <View
          key={member.userId}
          style={{
            borderColor: theme.containerBg,
            borderRadius: Math.round(diameter * 0.3),
            borderWidth: 1,
            left: slots[index][0] * size - diameter / 2,
            overflow: "hidden",
            position: "absolute",
            top: slots[index][1] * size - diameter / 2,
          }}
        >
          {index === 3 && members.length > 4 ? (
            <View
              style={{
                alignItems: "center",
                height: diameter,
                justifyContent: "center",
                width: diameter,
              }}
            >
              <Text
                style={{ color: theme.inputText, fontSize: size * 0.22 }}
              >{`+${members.length - 3}`}</Text>
            </View>
          ) : (
            <UserAvatar
              size={diameter}
              url={member.user.avatarUrl}
              userId={member.userId}
              username={member.user.username}
            />
          )}
        </View>
      ))}
    </View>
  );
}
