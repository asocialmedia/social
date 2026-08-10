"use client";

import signupImage from "@assets/auth/signup-image.jpg";
import loginImage from "@assets/previews/login.png";
import type { Variants } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import AnimatedAuthLink from "@/components/auth/animated-auth-link";
import SignUpForm from "@/components/auth/sign-up-form";

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
  hidden: { x: 100, opacity: 0 },
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

const AnimatedAsocialmediaText = () => {
  const letters = "ZEPHYR.".split("");

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="pointer-events-none fixed bottom-4 left-4 z-10 select-none font-bold text-4xl sm:text-6xl"
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

export default function ClientSignupPage() {
  return (
    <AnimatePresence>
      <motion.div
        animate="visible"
        className="relative flex min-h-screen overflow-hidden bg-background"
        initial="hidden"
        variants={fadeIn}
      >
        <div className="absolute inset-0 z-0 bg-gradient-to-bl from-primary/5 via-background to-background/95" />

        <motion.div
          className="absolute right-20 hidden h-full items-center md:flex"
          variants={slideIn}
        >
          <div className="relative">
            <h1 className="vertical-right absolute top-1/2 right-0 -translate-y-1/2 select-none whitespace-nowrap font-bold text-6xl text-primary/20 tracking-wider xl:text-8xl 2xl:text-9xl">
              SIGN UP
            </h1>
          </div>
        </motion.div>

        <div className="relative z-[1] flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            className="relative flex w-full max-w-5xl flex-col items-stretch rounded-2xl border border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl lg:flex-row"
            variants={scaleUp}
            whileHover={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
          >
            <div className="relative flex w-full flex-col justify-center px-6 py-12 sm:px-8 lg:w-1/2">
              <div className="mx-auto w-full max-w-sm">
                <motion.h2
                  className="mb-6 text-center font-bold text-3xl text-primary sm:text-4xl"
                  custom={0}
                  variants={contentAnimation}
                >
                  Launch Your Journey
                </motion.h2>

                <motion.div custom={1} variants={contentAnimation}>
                  <SignUpForm />
                </motion.div>

                <motion.div
                  className="mt-4 text-center"
                  custom={2}
                  variants={contentAnimation}
                >
                  <AnimatedAuthLink
                    href="/login"
                    previewImage={loginImage.src}
                    text="Already have an account? Login"
                  />
                </motion.div>
              </div>
            </div>

            <div className="hidden overflow-hidden rounded-r-2xl lg:flex lg:w-1/2">
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="relative h-full w-full bg-primary/80"
                initial={{ opacity: 0, x: 50 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <motion.div
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 bg-gradient-to-b from-transparent to-primary/20"
                  initial={{ opacity: 0 }}
                  transition={{ duration: 1 }}
                />
                <Image
                  alt="Signup illustration"
                  className="object-cover brightness-95"
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  src={signupImage}
                />
              </motion.div>
            </div>
          </motion.div>
        </div>

        <AnimatedAsocialmediaText />

        <motion.div
          animate={{ opacity: 0.05 }}
          className="absolute top-0 left-0 h-full w-full bg-center bg-cover opacity-5 blur-md lg:w-1/2"
          initial={{ opacity: 0 }}
          style={{ backgroundImage: `url(${signupImage.src})` }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
