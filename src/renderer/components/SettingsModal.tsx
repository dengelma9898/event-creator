import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, Eye, EyeOff, Check, AlertCircle, Trash2, Cloud, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { UploadTarget } from '../../shared/types.js';
import { DEFAULT_UPLOAD_TARGET, UPLOAD_TARGETS, UPLOAD_TARGET_LABELS } from '../../shared/upload-target.js';
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

  // Nürnbergspots-Verbindung (Upload) – je Stage eine eigene Anmeldung
  const [target, setTarget] = useState<UploadTarget>(DEFAULT_UPLOAD_TARGET);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkKeyStatus();
      setApiKeyInput('');
      setStatusMessage(null);
      setLoginPassword('');
      setLoginError(null);
    }
  }, [isOpen]);

  // Verbindung der gewählten Stage laden – beim Öffnen und beim Wechsel der Stage.
  useEffect(() => {
    if (isOpen) checkConnection(target);
  }, [isOpen, target]);

  const handleSelectTarget = (next: UploadTarget) => {
    if (next === target) return;
    setTarget(next);
    setConnectedEmail(null);
    setLoginEmail('');
    setLoginPassword('');
    setLoginError(null);
  };

  const checkConnection = async (current: UploadTarget) => {
    try {
      const status = await window.electronAPI.nuernbergspots.getStatus(current);
      setConnectedEmail(status.connected ? (status.email ?? 'angemeldet') : null);
    } catch {
      setConnectedEmail(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await window.electronAPI.nuernbergspots.login({
        target,
        email: loginEmail,
        password: loginPassword,
      });
      if (result.success) {
        setConnectedEmail(result.email ?? loginEmail.trim());
        setLoginEmail('');
      } else {
        setLoginError(result.error || 'Die Anmeldung hat nicht geklappt.');
      }
    } catch (err: any) {
      setLoginError(err?.message || 'Die Anmeldung hat nicht geklappt.');
    } finally {
      // Das Passwort bleibt in keinem Fall im Formular stehen.
      setLoginPassword('');
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await window.electronAPI.nuernbergspots.logout(target);
    } finally {
      setConnectedEmail(null);
      setLoginError(null);
    }
  };

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
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-foreground" />
                <h2 className="text-sm font-bold text-foreground">Einstellungen & Zugänge</h2>
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

              {/* Nürnbergspots-Verbindung (Upload) */}
              <div className="pt-4 border-t border-border space-y-3">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-foreground" />
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Verbindung zu Nürnbergspots
                  </h3>
                </div>

                <div role="radiogroup" aria-label="Stage" className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/50 border border-border">
                  {UPLOAD_TARGETS.map((option) => {
                    const active = option === target;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleSelectTarget(option)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                          active
                            ? "bg-background text-foreground border border-border shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {UPLOAD_TARGET_LABELS[option]}
                      </button>
                    );
                  })}
                </div>

                {connectedEmail ? (
                  <div className="p-3 rounded-xl flex items-center justify-between gap-3 border border-success/30 bg-success/10 text-xs">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-semibold block text-foreground">Verbunden mit {UPLOAD_TARGET_LABELS[target]}</span>
                        <p className="text-muted-foreground truncate" title={connectedEmail}>
                          Angemeldet als {connectedEmail}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={spring.snappy}
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border bg-background hover:bg-muted rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Abmelden</span>
                    </motion.button>
                  </div>
                ) : (
                  <form onSubmit={handleLogin} className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Melde dich einmal mit deinem Zugang für {UPLOAD_TARGET_LABELS[target]} an. Danach kannst du
                      fertige Termine direkt aus der App hochladen.
                    </p>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="E-Mail"
                      autoComplete="username"
                      className={cn(inputPreset, 'w-full px-3 py-2 text-xs')}
                    />
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Passwort"
                      autoComplete="current-password"
                      className={cn(inputPreset, 'w-full px-3 py-2 text-xs')}
                    />
                    {loginError && (
                      <div className="p-2.5 rounded-lg text-xs flex items-center gap-2 border border-destructive/30 bg-destructive/10 text-destructive">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{loginError}</span>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <motion.button
                        type="submit"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        disabled={isLoggingIn || !loginEmail.trim() || !loginPassword}
                        className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 text-xs font-semibold rounded-xl border border-secondary transition-colors cursor-pointer shadow-2xs"
                      >
                        {isLoggingIn ? 'Melde an...' : 'Anmelden'}
                      </motion.button>
                    </div>
                  </form>
                )}

                <p className="text-[11px] text-muted-foreground leading-normal">
                  Dein Passwort wird nicht gespeichert – nur eine verschlüsselte Anmeldung im macOS-Schlüsselbund.
                </p>
              </div>

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
