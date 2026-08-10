"use client";

import loginImage from "@assets/auth/login-image.jpg";
import signupImage from "@assets/previews/signup.png";
import type { Variants } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useCallback, useState } from "react";
import AnimatedAuthLink from "@/components/auth/animated-auth-link";
import AuthButtonWrapper from "@/components/auth/auth-button-wrapper";
import LoginForm from "@/components/auth/login-form";
import GoogleSignInButton from "./google-sign-in-button";
import RedditSignInButton from "./reddit-sign-in-button";

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

const slideIn: Variants = {
  hidden: { x: -100, opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: {
      duration: 0.8,
      ease: "easeOut",
      type: "spring",
      stiffness: 100,
    },
  },
};

const scaleUp: Variants = {
  hidden: { scale: 0.95, opacity: 0, y: 20 },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease: "easeOut",
      type: "spring",
      stiffness: 100,
    },
  },
};

const contentAnimation: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (custom: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      delay: custom * 0.1,
      ease: "easeOut",
    },
  }),
};

export default function ClientLoginPage() {
  const [activeProvider, setActiveProvider] = useState<
    "google" | "reddit" | null
  >(null);
  const isLoading = activeProvider !== null;
  const end = () => setActiveProvider(null);

  const handleGoogleStart = useCallback(() => setActiveProvider("google"), []);
  const handleRedditStart = useCallback(() => setActiveProvider("reddit"), []);

  return (
    <AnimatePresence>
      <motion.div
        animate="visible"
        className="relative flex min-h-screen overflow-hidden bg-background"
        initial="hidden"
        variants={fadeIn}
      >
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary/5 via-background to-background/95" />

        <motion.div
          className="absolute left-20 hidden h-full items-center md:flex"
          variants={slideIn}
        >
          <div className="relative">
            <h1 className="vertical-left absolute top-1/2 left-0 -translate-y-1/2 select-none whitespace-nowrap font-bold text-6xl text-primary/20 tracking-wider xl:text-8xl 2xl:text-9xl">
              LOGIN
            </h1>
          </div>
        </motion.div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            className="relative flex w-full max-w-5xl flex-col items-stretch rounded-2xl border border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl lg:flex-row"
            variants={scaleUp}
            whileHover={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
          >
            <div className="hidden overflow-hidden rounded-l-2xl lg:flex lg:w-1/2">
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="relative h-full w-full bg-primary/80"
                initial={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <motion.div
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 bg-gradient-to-b from-transparent to-primary/20"
                  initial={{ opacity: 0 }}
                  transition={{ duration: 1 }}
                />
                <Image
                  alt="Login illustration"
                  className="object-cover brightness-95"
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  src={loginImage}
                />
              </motion.div>
            </div>

            <div className="relative z-10 flex w-full flex-col justify-center px-6 py-12 sm:px-8 lg:w-1/2">
              <div className="mx-auto w-full max-w-sm">
                <motion.h2
                  className="mb-6 text-center font-bold text-3xl text-primary sm:text-4xl"
                  custom={0}
                  variants={contentAnimation}
                >
                  Welcome Back
                </motion.h2>

                <motion.div
                  className="mb-6"
                  custom={1}
                  variants={contentAnimation}
                >
                  <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 md:gap-2">
                    <AuthButtonWrapper className="w-full">
                      <GoogleSignInButton
                        disabled={isLoading && activeProvider !== "google"}
                        loading={activeProvider === "google"}
                        onEnd={end}
                        onStart={handleGoogleStart}
                      />
                    </AuthButtonWrapper>
                    <AuthButtonWrapper className="w-full">
                      <RedditSignInButton
                        disabled={isLoading && activeProvider !== "reddit"}
                        loading={activeProvider === "reddit"}
                        onEnd={end}
                        onStart={handleRedditStart}
                      />
                    </AuthButtonWrapper>
                  </div>
                </motion.div>

                <motion.div
                  className="my-6 flex items-center gap-3"
                  custom={2}
                  variants={contentAnimation}
                >
                  <motion.div
                    animate={{ scaleX: 1 }}
                    className="h-px flex-1 bg-muted"
                    initial={{ scaleX: 0 }}
                    transition={{ duration: 1, delay: 0.5 }}
                  />
                  <span className="px-2 text-muted-foreground text-sm">OR</span>
                  <motion.div
                    animate={{ scaleX: 1 }}
                    className="h-px flex-1 bg-muted"
                    initial={{ scaleX: 0 }}
                    transition={{ duration: 1, delay: 0.5 }}
                  />
                </motion.div>

                <motion.div custom={3} variants={contentAnimation}>
                  <LoginForm />
                </motion.div>

                <motion.div
                  className="mt-6 text-center"
                  custom={4}
                  variants={contentAnimation}
                >
                  <AnimatedAuthLink
                    href="/signup"
                    previewImage={signupImage.src}
                    text="Don't have an account? Sign Up"
                  />
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ opacity: 0.05 }}
          className="absolute top-0 right-0 h-full w-full bg-center bg-cover opacity-5 blur-md lg:w-1/2"
          initial={{ opacity: 0 }}
          style={{ backgroundImage: `url(${loginImage.src})` }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
