import type React from "react";
import { useInView } from "react-intersection-observer";

interface InfiniteScrollContainerProps extends React.PropsWithChildren {
  className?: string;
  onBottomReached: () => void;
}

export default function InfiniteScrollContainer({
  children,
  onBottomReached,
  className,
}: InfiniteScrollContainerProps) {
  const { ref } = useInView({
    onChange(inView) {
      if (inView) {
        onBottomReached();
      }
    },
    rootMargin: "200px",
  });

  return (
    <div className={className}>
      {children}
      <div ref={ref} />
    </div>
  );
}
