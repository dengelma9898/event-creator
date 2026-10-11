import React from 'react';
import { AlertTriangle, Play, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { backdropVariants, modalVariants, spring } from '../lib/motion.js';

interface CancelModalProps {
  isOpen: boolean;
  isCancelling: boolean;
  onConfirmCancel: () => void;
  onKeepRunning: () => void;
}

/**
 * Abbruch-Bestätigungsmodal (AP 3.3) mit weichem Spring-Ein-/Ausgang.
 */
export const CancelModal: React.FC<CancelModalProps> = ({
  isOpen,
  isCancelling,
  onConfirmCancel,
  onKeepRunning,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="cancel-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans"
        >
          <motion.div
            key="cancel-panel"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-md overflow-hidden"
          >
            {/* Warning Header */}
            <div className="p-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                Terminabruf beenden?
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Möchtest du den aktuellen Vorgang beenden? Bereits gespeicherte Termine bleiben in der CSV erhalten.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="p-4 bg-muted/30 border-t border-border flex items-center justify-end gap-3">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={onKeepRunning}
                disabled={isCancelling}
                className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer')}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Weiterlaufen lassen</span>
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={onConfirmCancel}
                disabled={isCancelling}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-destructive hover:bg-destructive/90 disabled:opacity-50 rounded-lg border border-destructive transition-colors cursor-pointer shadow-2xs"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{isCancelling ? 'Wird beendet & gespeichert...' : 'Jetzt beenden & speichern'}</span>
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
