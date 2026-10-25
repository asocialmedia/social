import type { Ref } from "react";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { premiumInput } from "@/components/surface/recipes";
import InlineRichInput from "@/features/composer/components/inline-rich-input";
import type { InlineRichInputRef } from "@/features/composer/components/inline-rich-input";
import { InlineSuggestions } from "@/features/composer/components/inline-suggestions";
import {
  activeTrigger,
  applySuggestion,
} from "@/features/composer/lib/inline-relations";
import type { MentionPick } from "@/features/composer/lib/inline-relations";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

const NO_TAGS: readonly string[] = [];
export function EddieRichField({
  value,
  onChange,
  onFocusChange,
  onSubmit,
  placeholder,
  inputRef,
  editable,
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  onFocusChange: (focused: boolean) => void;
  onSubmit: () => Promise<void>;
  placeholder: string;
  inputRef: Ref<InlineRichInputRef>;
  editable: boolean;
  autoFocus: boolean;
}) {
  const { isDark } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(24);
  const [cursor, setCursor] = useState(value.length);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [mentions, setMentions] = useState<MentionPick[]>([]);
  const excludedUsers = useMemo(
    () => mentions.map((user) => user.id),
    [mentions]
  );
  const field = premiumInput(isDark, focused);
  const trigger = focused && editable ? activeTrigger(value, cursor) : null;
  const pick = (token: string) => {
    if (!trigger) {
      return;
    }
    const next = applySuggestion(value, cursor, trigger, token);
    onChange(next.text);
    setCursor(next.cursor);
    setSelection({ end: next.cursor, start: next.cursor });
  };
  return (
    <View style={styles.root}>
      <View
        style={[
          styles.field,
          { backgroundColor: field.background, boxShadow: field.shadows },
        ]}
      >
        <InlineRichInput
          ref={inputRef}
          autoFocus={autoFocus}
          avatarBase={getApiBaseUrl()}
          color={field.text}
          isDark={isDark}
          label="Eddie"
          mentions={mentions}
          editable={editable}
          value={value}
          selection={selection}
          placeholder={placeholder}
          placeholderColor={field.placeholder}
          onChange={(text, range) => {
            onChange(text);
            setCursor(range.start);
            setSelection(null);
            return Promise.resolve();
          }}
          onFocusChange={(active) => {
            setFocused(active);
            onFocusChange(active);
            return Promise.resolve();
          }}
          onHeightChange={(next) => {
            setHeight(Math.max(24, Math.min(96, next)));
            return Promise.resolve();
          }}
          onSelectionChange={(range) => {
            setCursor(range.start);
            setSelection(null);
            return Promise.resolve();
          }}
          onSubmit={onSubmit}
          dom={{
            containerStyle: { backgroundColor: "transparent", flex: 0, height },
            keyboardDisplayRequiresUserAction: false,
            scrollEnabled: true,
            style: {
              backgroundColor: "transparent",
              flex: 0,
              height,
              width: "100%",
            },
            useExpoDOMWebView: true,
          }}
        />
      </View>
      <InlineSuggestions
        active={trigger}
        excludedTags={NO_TAGS}
        excludedUserIds={excludedUsers}
        onPickTag={pick}
        onPickUser={(user) => {
          setMentions((current) => [
            ...current.filter((item) => item.id !== user.id),
            user,
          ]);
          pick(user.username);
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  field: {
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  root: { flex: 1, minWidth: 0 },
});
