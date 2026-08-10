"use client";

import loginImage from "@assets/auth/login-image.jpg";
import signupImage from "@assets/previews/signup.png";
import { ArrowRight, FileText, Shield } from "lucide-react";
import type { Variants } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import AnimatedAuthLink from "@/components/auth/animated-auth-link";
import AuthButtonWrapper from "@/components/auth/auth-button-wrapper";
import LoginForm from "@/components/auth/login-form";
import DiscordSignInButton from "./discord-sign-in-button";
import GithubSignInButton from "./github-sign-in-button";
import GoogleSignInButton from "./google-sign-in-button";
import RedditSignInButton from "./reddit-sign-in-button";
import TwitterSignInButton from "./twitter-sign-in-button";

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

export const AnimatedAsocialmediaText = () => {
  const letters = "ZEPHYR.".split("");

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="pointer-events-none fixed right-4 bottom-4 z-10 select-none font-bold text-4xl sm:text-6xl"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.8, delay: 0.7 }}
    >
      <div className="relative flex">
        {letters.map((letter, i) => (
          <motion.span
            animate={{
              opacity: [0, 1, 1, 0.3, 1],
              y: [20, 0, 0, 0, 0],
            }}
            className="text-primary/50"
            initial={{ opacity: 0, y: 20 }}
            key={letter}
            style={{
              textShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
              display: "inline-block",
            }}
            transition={{
              duration: 4,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
              delay: i * 0.1,
              times: [0, 0.2, 0.5, 0.8, 1],
            }}
          >
            {letter}
          </motion.span>
        ))}
      </div>

      <motion.div
        animate={{
          scaleX: [0, 1, 1, 1, 0],
          opacity: [0, 1, 1, 0.3, 0],
        }}
        className="absolute bottom-0 left-0 h-0.5 bg-primary/30"
        initial={{ scaleX: 0 }}
        style={{ transformOrigin: "left" }}
        transition={{
          duration: 4,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
          times: [0, 0.2, 0.5, 0.8, 1],
        }}
      />
    </motion.div>
  );
};

export default function ClientLoginPage() {
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [activeProvider, setActiveProvider] = useState<
    "google" | "reddit" | "github" | "discord" | "twitter" | null
  >(null);
  const isLoading = activeProvider !== null;
  const end = () => setActiveProvider(null);

  const handleGithubStart = useCallback(() => setActiveProvider("github"), []);
  const handleDiscordStart = useCallback(
    () => setActiveProvider("discord"),
    []
  );
  const handleTwitterStart = useCallback(
    () => setActiveProvider("twitter"),
    []
  );
  const handleGoogleStart = useCallback(() => setActiveProvider("google"), []);
  const handleRedditStart = useCallback(() => setActiveProvider("reddit"), []);
  const handleShowLess = useCallback(() => setShowMoreOptions(false), []);
  const handleShowMore = useCallback(() => setShowMoreOptions(true), []);

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
            className="relative flex w-full max-w-5xl flex-col rounded-2xl border border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl lg:flex-row"
            variants={scaleUp}
            whileHover={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
          >
            <div className="hidden overflow-hidden rounded-l-2xl lg:block lg:w-1/2">
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="relative min-h-[200px] w-full bg-primary/80 lg:min-h-[850px]"
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
                  {showMoreOptions ? (
                    <motion.div
                      animate={{ opacity: 1 }}
                      initial={{ opacity: 0 }}
                      transition={{
                        duration: 0.4,
                        ease: "easeOut",
                      }}
                    >
                      <div className="grid grid-cols-3 gap-3">
                        <AuthButtonWrapper className="h-full">
                          <GithubSignInButton
                            disabled={isLoading && activeProvider !== "github"}
                            loading={activeProvider === "github"}
                            onEnd={end}
                            onStart={handleGithubStart}
                          />
                        </AuthButtonWrapper>
                        <AuthButtonWrapper className="h-full">
                          <DiscordSignInButton
                            disabled={isLoading && activeProvider !== "discord"}
                            loading={activeProvider === "discord"}
                            onEnd={end}
                            onStart={handleDiscordStart}
                          />
                        </AuthButtonWrapper>
                        <AuthButtonWrapper className="h-full">
                          <TwitterSignInButton
                            disabled={isLoading && activeProvider !== "twitter"}
                            loading={activeProvider === "twitter"}
                            onEnd={end}
                            onStart={handleTwitterStart}
                          />
                        </AuthButtonWrapper>
                      </div>

                      <div className="w-full text-center">
                        <motion.button
                          animate={{ opacity: 1 }}
                          className="inline-flex cursor-pointer items-center justify-center gap-1 text-muted-foreground text-sm transition-colors duration-300 hover:text-primary"
                          initial={{ opacity: 0 }}
                          onClick={handleShowLess}
                          transition={{
                            duration: 0.3,
                            delay: 0.2,
                          }}
                        >
                          Show less
                        </motion.button>
                      </div>
                    </motion.div>
                  ) : (
                    <>
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

                      <motion.div
                        animate={{ opacity: 1 }}
                        className="w-full text-center"
                        initial={{ opacity: 0 }}
                        transition={{
                          duration: 0.4,
                          ease: "easeOut",
                        }}
                      >
                        <button
                          className="cursor-pointer text-muted-foreground text-sm transition-colors duration-300 hover:text-primary"
                          disabled={isLoading}
                          onClick={handleShowMore}
                          type="button"
                        >
                          See more options
                        </button>
                      </motion.div>
                    </>
                  )}
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

                <motion.div
                  className="mt-8"
                  custom={5}
                  variants={contentAnimation}
                >
                  <div className="rounded-lg border border-primary/10 bg-primary/5 p-4 backdrop-blur-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <Link
                        className="group flex flex-col gap-2 rounded-lg border border-primary/5 bg-background/80 p-3 transition-all hover:bg-accent hover:shadow-xs"
                        href="/toc"
                      >
                        <div className="flex items-center gap-2">
                          <div className="rounded-full bg-primary/10 p-1.5 transition-colors group-hover:bg-primary/20">
                            <FileText className="h-3 w-3 text-primary" />
                          </div>
                          <span className="font-medium text-foreground/80 text-xs transition-colors group-hover:text-primary">
                            Terms
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          Read our terms of service
                        </p>
                      </Link>

                      <Link
                        className="group flex flex-col gap-2 rounded-lg border border-primary/5 bg-background/80 p-3 transition-all hover:bg-accent hover:shadow-xs"
                        href="/privacy"
                      >
                        <div className="flex items-center gap-2">
                          <div className="rounded-full bg-primary/10 p-1.5 transition-colors group-hover:bg-primary/20">
                            <Shield className="h-3 w-3 text-primary" />
                          </div>
                          <span className="font-medium text-foreground/80 text-xs transition-colors group-hover:text-primary">
                            Privacy
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          View our privacy policy
                        </p>
                      </Link>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-primary/5 border-t pt-3">
                      <p className="text-[10px] text-muted-foreground">
                        By signing in, you agree to our terms and privacy policy
                      </p>
                      <Link href="/privacy">
                        <motion.div
                          className="rounded-full bg-primary/10 p-1.5"
                          initial={{ scale: 0.95 }}
                          whileHover={{ scale: 1 }}
                        >
                          <ArrowRight className="h-3 w-3 text-primary" />
                        </motion.div>
                      </Link>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="pointer-events-none fixed right-4 bottom-4 z-10 select-none font-bold text-4xl text-primary/50 sm:text-6xl">
          <AnimatedAsocialmediaText />
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
