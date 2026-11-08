import { Gesture } from "react-native-gesture-handler";

// The floating header is a sibling of the list, so native scroll cannot
// receive its drags. Forward vertical pans while taps stay with its controls.
export function createCommunityHeaderPan({
  getOffset,
  scrollTo,
  refreshGesture,
}: {
  refreshGesture: ReturnType<typeof Gesture.Pan>;
  getOffset: () => number;
  scrollTo: (offset: number) => void;
}) {
  let startOffset = 0;
  return Gesture.Pan()
    .runOnJS(true)
    .simultaneousWithExternalGesture(refreshGesture)
    .activeOffsetY([-8, 8])
    .failOffsetX([-16, 16])
    .onBegin(() => {
      startOffset = getOffset();
    })
    .onUpdate((event) => {
      scrollTo(Math.max(0, startOffset - event.translationY));
    });
}
