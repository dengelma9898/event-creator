import React, { useState } from 'react';
import { Key, Eye, EyeOff, ShieldAlert, Sparkles, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { inputPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { backdropVariants, modalVariants, spring } from '../lib/motion.js';

interface OnboardingModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

/**
 * Automatisches Willkommens-Modal beim ersten Start (AP 3.2).
 * Poppt NUR auf, wenn noch kein Schlüssel im Keychain hinterlegt ist.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onSuccess,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) {
      setError('Bitte gib den Zugriffsschlüssel ein.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const ok = await window.electronAPI.apiKey.set(apiKeyInput.trim());
      if (ok) {
        onSuccess();
      } else {
        setError('Der Schlüssel konnte nicht verschlüsselt im Schlüsselbund gespeichert werden.');
      }
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Speichern.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="onboarding-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans"
        >
          <motion.div
            key="onboarding-panel"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-md overflow-hidden"
          >
            {/* Banner with Icon */}
            <div className="bg-muted/30 p-6 text-center border-b border-border">
              <motion.div
                initial={{ scale: 0.6, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={spring.bouncy}
                className="w-10 h-10 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center mx-auto mb-3 border border-border"
              >
                <Sparkles className="w-5 h-5" />
              </motion.div>
              <h1 className="text-base font-bold text-foreground">Willkommen bei Event Creator!</h1>
              <p className="text-muted-foreground text-xs max-w-xs mx-auto mt-1 leading-relaxed">
                Dein Werkzeug zum einfachen und automatischen Erfassen regionaler Veranstaltungsdaten auf Knopfdruck.
              </p>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              <div className="space-y-1.5">
                <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3.5 h-3.5" />
                  <span>Einmalige Ersteinrichtung</span>
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Bevor es losgehen kann, wird der persönliche Cursor-Zugriffsschlüssel benötigt. Bitte Domi, ihn einmalig für dich einzutragen, oder füge ihn selbst ein.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                    Zugriffsschlüssel (Cursor API Key)
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="key_..."
                      autoFocus
                      className={cn(inputPreset, 'w-full pr-10 pl-3 py-2 text-xs font-mono')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  disabled={isSaving || !apiKeyInput.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 font-semibold text-xs border border-secondary transition-colors cursor-pointer shadow-2xs"
                >
                  {isSaving ? (
                    <span>Wird gespeichert...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Einrichtung abschließen & starten</span>
                    </>
                  )}
                </motion.button>
              </form>

              <p className="text-[11px] text-muted-foreground text-center leading-normal">
                Sicher verschlüsselt im macOS-Schlüsselbund (Apple Keychain).
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
