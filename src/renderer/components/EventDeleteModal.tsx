import React from 'react';
import { Trash2, X, AlertTriangle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { CsvEventRecord } from '../../shared/types.js';
import { buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { backdropVariants, modalVariants, spring } from '../lib/motion.js';

interface EventDeleteModalProps {
  isOpen: boolean;
  event: CsvEventRecord | null;
  isDeleting: boolean;
  error?: string | null;
  /** true, wenn die Datei durch den fehlgeschlagenen Löschversuch unverändert blieb. */
  fileUnchanged?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const EventDeleteModal: React.FC<EventDeleteModalProps> = ({
  isOpen,
  event,
  isDeleting,
  error,
  fileUnchanged,
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {isOpen && event && (
        <motion.div
          key="delete-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans"
        >
          <motion.div
            key="delete-panel"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-md overflow-hidden"
          >
            {/* Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2 text-destructive font-semibold text-xs">
                <Trash2 className="w-4 h-4" />
                <span>Event aus CSV entfernen</span>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={isDeleting}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="space-y-1 flex-1">
                  <p className="font-semibold text-foreground">
                    Möchtest du dieses Event wirklich löschen?
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Der Eintrag wird direkt aus der CSV-Datei entfernt. Anschließend wird die Datei automatisch neu validiert.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-muted/40 rounded-xl border border-border space-y-1.5">
                <div className="font-semibold text-foreground text-xs line-clamp-2">
                  {event.title}
                </div>
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>📅 {event.startDate || 'Ohne Datum'}</span>
                  {event.startTime && <span>⏰ {event.startTime} Uhr</span>}
                  {event.location && <span className="truncate max-w-[200px]">📍 {event.location}</span>}
                </div>
                <div className="text-[10px] text-muted-foreground/80 font-mono truncate pt-1 border-t border-border/50">
                  Datei: {event.fileName}
                </div>
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-[11px] leading-relaxed space-y-1">
                  <p>{error}</p>
                  <p className="text-destructive/80">
                    {fileUnchanged
                      ? 'Die Datei wurde nicht verändert.'
                      : 'Bitte prüfe die Datei, ihr Zustand ist unklar.'}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-muted/20 border-t border-border flex items-center justify-end gap-3">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={onCancel}
                disabled={isDeleting}
                className={cn(buttonPreset, 'px-3 py-1.5 text-xs font-semibold cursor-pointer')}
              >
                Abbrechen
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={onConfirm}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-destructive hover:bg-destructive/90 disabled:opacity-50 rounded-lg border border-destructive transition-colors cursor-pointer shadow-2xs"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Wird gelöscht...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Event endgültig löschen</span>
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
