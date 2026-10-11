import type { Transition, Variants } from 'motion/react';

/**
 * Standardisierte Spring- und Transition-Konfigurationen
 * für ein konsistentes, nativ-wertiges Mac-Look & Feel mit Spaßfaktor.
 */
export const spring = {
  /** Schneller, präziser Spring für Tabs, Toggles und Micro-Interactions */
  snappy: {
    type: 'spring',
    stiffness: 420,
    damping: 30,
    mass: 0.8,
  } satisfies Transition,

  /** Weicher, natürlicher Spring für Modals, Karten und Layout-Transitions */
  soft: {
    type: 'spring',
    stiffness: 260,
    damping: 26,
    mass: 1,
  } satisfies Transition,

  /** Verspielter, federnder Spring für Badges, Zähler-Pops und Erfolgs-Elemente */
  bouncy: {
    type: 'spring',
    stiffness: 450,
    damping: 18,
    mass: 0.8,
  } satisfies Transition,

  /** Sanfte, flüssige Ease für Einblendungen */
  smooth: {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1],
  } satisfies Transition,
};

/** Micro-Interaktions-Props für Buttons */
export const tapHover = {
  button: {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.97 },
    transition: spring.snappy,
  },
  card: {
    whileHover: { y: -2 },
    whileTap: { scale: 0.99 },
    transition: spring.snappy,
  },
  iconButton: {
    whileHover: { scale: 1.08 },
    whileTap: { scale: 0.92 },
    transition: spring.snappy,
  },
};

/** Wiederverwendbare Motion-Variants */
export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: spring.soft,
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.16 },
  },
};

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

export const scalePopVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: spring.bouncy,
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.15 },
  },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: spring.soft,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 4,
    transition: { duration: 0.15 },
  },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
};

/** Container für gestaffeltes Einblenden der Kinder */
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.04,
    },
  },
};

/** Varianten für Tab-Übergänge mit Richtungsangabe */
export const tabSlideVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 32 : -32,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: spring.soft,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 32 : -32,
    opacity: 0,
    transition: { duration: 0.16 },
  }),
};
