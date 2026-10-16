import { useLocalSearchParams, useRouter } from "expo-router";

import { DenDialog } from "@/features/messages/components/den-dialog";

export default function DenJoinScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const initialCode = Array.isArray(code) ? code[0] : code;
  return (
    <DenDialog
      mode="join"
      initialCode={initialCode ?? ""}
      onClose={() => router.replace("/messages")}
      onOpen={(id) => router.replace(`/messages/${id}`)}
    />
  );
}
