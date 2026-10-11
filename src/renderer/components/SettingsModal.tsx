import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, Eye, EyeOff, Check, AlertCircle, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { inputPreset, buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { backdropVariants, modalVariants, spring } from '../lib/motion.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyStatusChanged: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onKeyStatusChanged,
}) => {
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkKeyStatus();
      setApiKeyInput('');
      setStatusMessage(null);
    }
  }, [isOpen]);

  const checkKeyStatus = async () => {
    try {
      const configured = await window.electronAPI.apiKey.isConfigured();
      setIsConfigured(configured);
    } catch {
      setIsConfigured(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) {
      setStatusMessage({ type: 'error', text: 'Bitte gib einen gültigen Schlüssel ein.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const success = await window.electronAPI.apiKey.set(apiKeyInput.trim());
      if (success) {
        setIsConfigured(true);
        setApiKeyInput('');
        setStatusMessage({ type: 'success', text: 'Schlüssel erfolgreich im Schlüsselbund gespeichert!' });
        onKeyStatusChanged();
        setTimeout(() => {
          setStatusMessage(null);
        }, 3000);
      } else {
        setStatusMessage({ type: 'error', text: 'Schlüssel konnte nicht verschlüsselt werden.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Fehler beim Speichern.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      await window.electronAPI.apiKey.clear();
      setIsConfigured(false);
      setApiKeyInput('');
      setStatusMessage({ type: 'success', text: 'Schlüssel wurde sicher aus dem Schlüsselbund entfernt.' });
      onKeyStatusChanged();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Fehler beim Entfernen.' });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="settings-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans"
        >
          <motion.div
            key="settings-panel"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-md overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-foreground" />
                <h2 className="text-sm font-bold text-foreground">Einstellungen & Schlüssel</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                aria-label="Schließen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              {/* Key Status Badge */}
              <div
                className={cn(
                  'p-3 rounded-xl flex items-start gap-2.5 border text-xs leading-relaxed',
                  isConfigured
                    ? 'border-success/30 bg-success/10 text-foreground'
                    : 'border-warning/30 bg-warning/10 text-foreground'
                )}
              >
                {isConfigured ? (
                  <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                )}
                <div>
                  <span className="font-semibold block text-xs mb-0.5 text-foreground">
                    {isConfigured ? 'Zugriffsschlüssel aktiv' : 'Noch kein Schlüssel eingerichtet'}
                  </span>
                  <p className="text-muted-foreground">
                    {isConfigured
                      ? 'Dein Cursor-Zugangsschlüssel ist sicher im macOS-Schlüsselbund (Keychain) hinterlegt.'
                      : 'Bitte trage den Schlüssel ein, um automatische Terminabrufe durchführen zu können.'}
                  </p>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                    {isConfigured ? 'Schlüssel aktualisieren' : 'Cursor API-Schlüssel eintragen'}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={isConfigured ? '••••••••••••••••••••••••' : 'key_...'}
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    Frag Domi, falls du deinen Schlüssel nicht zur Hand hast.
                  </p>
                </div>

                {statusMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring.snappy}
                    className={cn(
                      'p-2.5 rounded-lg text-xs flex items-center gap-2 border',
                      statusMessage.type === 'success'
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                    )}
                  >
                    {statusMessage.type === 'success' ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    )}
                    <span>{statusMessage.text}</span>
                  </motion.div>
                )}

                <div className="flex items-center justify-between pt-2">
                  {isConfigured ? (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={spring.snappy}
                      onClick={handleClear}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Schlüssel entfernen</span>
                    </motion.button>
                  ) : (
                    <div />
                  )}

                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={spring.snappy}
                    disabled={isSaving || !apiKeyInput.trim()}
                    className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 text-xs font-semibold rounded-xl border border-secondary transition-colors cursor-pointer shadow-2xs"
                  >
                    {isSaving ? 'Speichere...' : 'Schlüssel speichern'}
                  </motion.button>
                </div>
              </form>

              {/* Privacy & Security Note */}
              <div className="pt-2 border-t border-border text-[11px] text-muted-foreground leading-normal">
                Sicherheitshinweis: Der Schlüssel wird ausschließlich lokal auf deinem Mac über Electrons native
                <code className="text-foreground bg-muted px-1 py-0.5 rounded border border-border ml-1 mr-1">
                  safeStorage
                </code>
                (Apple Keychain) verschlüsselt gespeichert.
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 bg-muted/20 border-t border-border flex justify-end">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={onClose}
                className={cn(buttonPreset, 'px-3 py-1.5 text-xs font-medium cursor-pointer')}
              >
                Schließen
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
