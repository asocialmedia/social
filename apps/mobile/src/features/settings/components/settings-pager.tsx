import PagerView from "@expo/ui/community/pager-view";
import type { PagerViewRef } from "@expo/ui/community/pager-view";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { FeedPager } from "@/features/feed/components/feed-pager";

interface SettingsPagerProps {
  activeIndex: number;
  children: ReactNode[];
  onIndexChange: (index: number) => void;
}

export function SettingsPager(props: SettingsPagerProps) {
  if (Platform.OS === "android") {
    return <AndroidSettingsPager {...props} />;
  }
  return <FeedPager preloadAll publishOnSettle rasterizePages {...props} />;
}

function AndroidSettingsPager({
  activeIndex,
  children,
  onIndexChange,
}: SettingsPagerProps) {
  const pager = useRef<PagerViewRef>(null);
  const settledIndex = useRef(activeIndex);
  const pendingIndex = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (activeIndex === settledIndex.current && pendingIndex.current === null) {
      return;
    }
    pendingIndex.current = activeIndex;
    if (reducedMotion) {
      pager.current?.setPageWithoutAnimation(activeIndex);
    } else {
      pager.current?.setPage(activeIndex);
    }
  }, [activeIndex, reducedMotion]);

  return (
    <PagerView
      initialPage={activeIndex}
      offscreenPageLimit={children.length - 1}
      onPageScrollStateChanged={(event) => {
        if (event.nativeEvent.pageScrollState === "dragging") {
          // A live swipe can interrupt a tap-driven transition.
          pendingIndex.current = null;
        }
      }}
      onPageSelected={(event) => {
        const next = event.nativeEvent.position;
        // A late completion from an interrupted tap must not undo a newer tab.
        if (pendingIndex.current !== null && next !== pendingIndex.current) {
          return;
        }
        pendingIndex.current = null;
        settledIndex.current = next;
        onIndexChange(next);
      }}
      ref={pager}
      style={styles.pager}
    >
      {children.map((child, index) => (
        <View collapsable={false} key={index} style={styles.pager}>
          {child}
        </View>
      ))}
    </PagerView>
  );
}

const styles = StyleSheet.create({ pager: { flex: 1 } });
