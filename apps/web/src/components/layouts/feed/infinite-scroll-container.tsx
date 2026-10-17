import type React from "react";
import { useEffect } from "react";
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
  const { ref, inView } = useInView({
    rootMargin: "200px",
  });

  useEffect(() => {
    if (inView) {
      onBottomReached();
    }
  }, [inView, onBottomReached]);

  return (
    <div className={className}>
      {children}
      <div ref={ref} />
    </div>
  );
}
