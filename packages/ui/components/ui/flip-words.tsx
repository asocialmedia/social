"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";

export const FlipWords = ({
  words,
  duration = 3000,
  className,
}: {
  words: string[];
  duration?: number;
  className?: string;
}) => {
  const [currentWord, setCurrentWord] = useState(words[0]);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  // thanks for the fix Julian - https://github.com/Julian-AT
  const startAnimation = useCallback(() => {
    const word = words[words.indexOf(currentWord) + 1] || words[0];
    setCurrentWord(word);
    setIsAnimating(true);
  }, [currentWord, words]);

  useEffect(() => {
    if (!isAnimating) {
      setTimeout(() => {
        startAnimation();
      }, duration);
    }
  }, [isAnimating, duration, startAnimation]);

  const wordSegments = useMemo(
    () =>
      [...currentWord.matchAll(/\S+/g)].map((match) => ({
        start: match.index ?? 0,
        word: match[0],
      })),
    [currentWord]
  );

  const handleExitComplete = useCallback(() => {
    setIsAnimating(false);
  }, []);

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      <motion.div
        animate={{
          opacity: 1,
          y: 0,
        }}
        className={cn(
          "relative z-10 inline-block px-2 text-left text-neutral-900 dark:text-neutral-100",
          className
        )}
        exit={{
          filter: "blur(8px)",
          opacity: 0,
          position: "absolute",
          scale: 2,
          x: 40,
          y: -40,
        }}
        initial={{
          opacity: 0,
          y: 10,
        }}
        key={currentWord}
        transition={{
          damping: 10,
          stiffness: 100,
          type: "spring",
        }}
      >
        {/* edit suggested by Sajal: https://x.com/DewanganSajal */}
        {wordSegments.map((segment) => (
          <motion.span
            animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
            className="inline-block whitespace-nowrap"
            initial={{ filter: "blur(8px)", opacity: 0, y: 10 }}
            key={`${currentWord}-${segment.start}`}
            transition={{
              delay: segment.start * 0.03,
              duration: 0.3,
            }}
          >
            {[...segment.word].map((letter, letterIndex) => (
              <motion.span
                animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
                className="inline-block"
                initial={{ filter: "blur(8px)", opacity: 0, y: 10 }}
                key={`${segment.start}-${letterIndex}`}
                transition={{
                  delay: segment.start * 0.03 + letterIndex * 0.05,
                  duration: 0.2,
                }}
              >
                {letter}
              </motion.span>
            ))}
            <span className="inline-block">&nbsp;</span>
          </motion.span>
        ))}
      </motion.div>
    </AnimatePresence>
  );
};
