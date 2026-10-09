// The fullscreen image viewer for a message album.
//
// Ported from web's message-conversation-viewer. Same shape as the post media
// viewer already in this app, reduced to what a chat needs: swipe between the
// images of ONE message, with a numbered strip and pinch-to-zoom left to the
// system image viewer's own gesture handling.
//
// The index is owned by the parent so the album it belongs to stays identifiable
// when the user swipes out of the thread: closing passes null rather than an
// out-of-range index.
import { X } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MessageImage } from "./messages-primitives";

export function MessageMediaViewer({
  images,
  index,
  onClose,
}: {
  images: string[];
  index: number | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Keep swipe state local and tie it to the opened album and initial image.
  const selectionKey = `${images.join("|")}:${index}`;
  const [selection, setSelection] = useState<{
    key: string;
    page: number;
  } | null>(null);
  const active =
    index === null
      ? null
      : Math.max(
          0,
          Math.min(
            selection?.key === selectionKey ? selection.page : index,
            images.length - 1
          )
        );
  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      setSelection({
        key: selectionKey,
        page: Math.round(event.nativeEvent.contentOffset.x / width),
      });
    },
    [selectionKey, width]
  );

  if (index === null || images.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        onMomentumScrollEnd={handleMomentumEnd}
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: (active ?? 0) * width, y: 0 }}
      >
        {images.map((uri) => (
          <MessageImage
            contentFit="contain"
            key={uri}
            source={uri}
            style={{ height: "100%", width }}
          />
        ))}
      </ScrollView>
      <Pressable
        accessibilityLabel="Close"
        hitSlop={12}
        onPress={onClose}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <X color="#ffffff" size={22} />
      </Pressable>
      {images.length > 1 ? (
        <View style={[styles.counter, { bottom: insets.bottom + 16 }]}>
          <Text style={styles.counterText}>
            {(active ?? 0) + 1} / {images.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    backgroundColor: "#00000066",
    borderRadius: 9999,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: 16,
    width: 38,
  },
  counter: {
    alignSelf: "center",
    backgroundColor: "#00000099",
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    position: "absolute",
  },
  counterText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  root: {
    backgroundColor: "#000000",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    // Above everything including the composer, so a tap anywhere outside an image
    // reaches the close button's own hit area and not the keyboard-dismissable
    // composer underneath.
    zIndex: 100,
  },
});
