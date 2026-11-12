import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollViewInstance, ViewInstance } from "react-native";
import { Keyboard, Text, View } from "react-native";

import { AnimatedWordCounter } from "@/components/feedback/animated-word-counter";
import { premiumInput } from "@/components/surface/recipes";
import InlineRichInput from "@/features/composer/components/inline-rich-input";
import { InlineSuggestions } from "@/features/composer/components/inline-suggestions";
import {
  activeTrigger,
  applySuggestion,
} from "@/features/composer/lib/inline-relations";
import type { MentionPick } from "@/features/composer/lib/inline-relations";
import {
  BIO_WORD_LIMIT,
  countBioWords,
} from "@/features/settings/lib/bio-editor";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

export function ProfileBioEditor({
  value,
  onChangeText,
  scrollRef,
  onFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  scrollRef?: RefObject<ScrollViewInstance | null>;
  onFocus?: () => void;
}) {
  const [mentions, setMentions] = useState<MentionPick[]>([]);
  const { theme, isDark } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const fieldRef = useRef<ViewInstance>(null);
  const scrollIntoView = useCallback(() => {
    if (onFocus) {
      onFocus();
      return;
    }
    if (fieldRef.current) {
      scrollRef?.current?.scrollResponderScrollNativeHandleToKeyboard(
        fieldRef.current,
        110,
        true
      );
    }
  }, [onFocus, scrollRef]);
  useEffect(() => {
    if (!focused) {
      return;
    }
    const listener = Keyboard.addListener("keyboardDidShow", scrollIntoView);
    scrollIntoView();
    return () => listener.remove();
  }, [focused, scrollIntoView]);
  const [height, setHeight] = useState(96);
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const field = premiumInput(isDark, focused);
  const trigger = focused ? activeTrigger(value, cursor) : null;
  const pick = (token: string) => {
    if (!trigger) {
      return;
    }
    const next = applySuggestion(value, cursor, trigger, token);
    onChangeText(next.text);
    setCursor(next.cursor);
    setSelection({ end: next.cursor, start: next.cursor });
  };
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: theme.dividerText,
          fontFamily: "SofiaProMed",
          fontSize: 14,
        }}
      >
        Bio
      </Text>
      <View
        ref={fieldRef}
        style={{
          backgroundColor: field.background,
          borderCurve: "continuous",
          borderRadius: 12,
          boxShadow: field.shadows,
          padding: 12,
        }}
      >
        <InlineRichInput
          avatarBase={getApiBaseUrl()}
          mentions={mentions}
          label="Bio"
          color={field.text}
          isDark={isDark}
          value={value}
          selection={selection}
          placeholder="Tell us a little bit about yourself - @mention, #tag or drop a link"
          placeholderColor={field.placeholder}
          onChange={(text, range) => {
            onChangeText(text.slice(0, 2000));
            setCursor(range.start);
            setSelection(null);
            return Promise.resolve();
          }}
          onFocusChange={(active) => {
            setFocused(active);
            return Promise.resolve();
          }}
          onHeightChange={(next) => {
            setHeight(Math.max(96, next));
            return Promise.resolve();
          }}
          onSelectionChange={(range) => {
            setCursor(range.start);
            setSelection(null);
            return Promise.resolve();
          }}
          dom={{
            containerStyle: { backgroundColor: "transparent", flex: 0, height },
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
        excludedTags={[]}
        excludedUserIds={[]}
        onPickTag={pick}
        onPickUser={(user) => {
          setMentions((current) => [
            ...current.filter((mention) => mention.id !== user.id),
            user,
          ]);
          pick(user.username);
        }}
      />
      {/* Web: the word counter sits right-aligned under the field. The pills
          already render inside the field, so there is no separate preview. */}
      <View style={{ alignItems: "flex-end" }}>
        <AnimatedWordCounter
          current={countBioWords(value)}
          max={BIO_WORD_LIMIT}
        />
      </View>
    </View>
  );
}
