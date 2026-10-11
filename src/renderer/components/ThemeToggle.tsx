import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../contexts/ThemeContext.js';
import { spring, tapHover } from '../lib/motion.js';

/**
 * Theme-Toggle-Komponente für Dark/Light Mode mit verspielter Rotations-Animation
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <motion.button
      type="button"
      {...tapHover.iconButton}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors app-no-drag focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer overflow-hidden"
      aria-label="Theme umschalten"
      title={isDark ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="sun"
            initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
            transition={spring.snappy}
          >
            <Sun className="h-4 w-4 text-foreground" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={{ rotate: 90, scale: 0.5, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: -90, scale: 0.5, opacity: 0 }}
            transition={spring.snappy}
          >
            <Moon className="h-4 w-4 text-foreground" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
