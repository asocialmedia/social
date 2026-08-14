export const stepVariants = {
  center: {
    opacity: 1,
    transition: {
      duration: 0.3,
    },
    x: 0,
  },
  enter: {
    opacity: 0,
    x: 20,
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.3,
    },
    x: -20,
  },
};

export const formContainerVariants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.5,
    },
    y: 0,
  },
};
