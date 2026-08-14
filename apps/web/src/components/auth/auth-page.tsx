"use client";

import loginImage from "@assets/auth/login-image.jpg";
import signupImage from "@assets/auth/signup-image.jpg";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import AuthCard from "@/components/auth/auth-card";

type AuthMode = "login" | "signup";

export default function AuthPage({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  // Keep local mode in sync if the route changes via browser back/forward
  useEffect(() => {
    // eslint-disable-next-line react-compiler -- sync the tab with the URL on back/forward navigation
    setMode(initialMode);
  }, [initialMode]);

  const isLogin = mode === "login";

  return (
    <AnimatePresence>
      <motion.div
        animate="visible"
        className="bg-background relative flex min-h-screen overflow-hidden"
        initial="hidden"
        transition={{ duration: 0.6, ease: "easeOut" }}
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
      >
        <div
          className={`absolute inset-0 z-0 ${
            isLogin
              ? "from-primary/5 via-background to-background/95 bg-gradient-to-br"
              : "from-primary/5 via-background to-background/95 bg-gradient-to-bl"
          }`}
        />

        <div
          className={`absolute hidden h-full items-center md:flex ${
            isLogin ? "left-20" : "right-20"
          }`}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.h1
              animate={{ opacity: 1, x: 0 }}
              className={`text-3d absolute top-1/2 -translate-y-1/2 text-6xl font-bold tracking-wider whitespace-nowrap select-none xl:text-8xl 2xl:text-9xl ${
                isLogin ? "vertical-left left-0" : "vertical-right right-0"
              }`}
              exit={{ opacity: 0, x: isLogin ? 40 : -40 }}
              initial={{ opacity: 0, x: isLogin ? -80 : 80 }}
              key={mode}
              transition={{
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {isLogin ? "LOGIN" : "SIGN UP"}
            </motion.h1>
          </AnimatePresence>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <AuthCard mode={mode} onSwitch={setMode} />
        </div>

        <motion.div
          animate={{ opacity: 0.05 }}
          className={`absolute top-0 h-full w-full bg-cover bg-center opacity-5 blur-md lg:w-1/2 ${
            isLogin ? "right-0" : "left-0"
          }`}
          initial={{ opacity: 0 }}
          style={{
            backgroundImage: `url(${isLogin ? loginImage.src : signupImage.src})`,
          }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
