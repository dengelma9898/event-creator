import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  XCircle,
  Loader2,
  Copy,
  Check,
  ShieldCheck,
  LogOut,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import type { CsvFileInfo, NuernbergspotsStatus, UploadResult, UploadTarget } from '../../shared/types.js';
import { summarizeUpload } from '../../shared/upload-summary.js';
import { DEFAULT_UPLOAD_TARGET, UPLOAD_TARGETS, UPLOAD_TARGET_LABELS } from '../../shared/upload-target.js';
import { inputPreset, buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { backdropVariants, modalVariants, spring } from '../lib/motion.js';

interface UploadConfirmModalProps {
  isOpen: boolean;
  /** Dateien, die beim Öffnen schon angehakt sind (z. B. die des gerade beendeten Abrufs). */
  preselected: string[];
  onClose: () => void;
}

type Phase = 'form' | 'uploading' | 'result';

const TARGET_HINTS: Record<UploadTarget, string> = {
  test: 'Die Termine landen nur in der Citylife-Testumgebung.',
  prod: 'Die Termine sind danach sofort in der Nürnbergspots-App sichtbar. Spätere Änderungen hier gehen nicht automatisch online.',
};

const TONE_BOX = {
  success: 'border-success/30 bg-success/10',
  warning: 'border-warning/30 bg-warning/10',
  error: 'border-destructive/30 bg-destructive/10',
} as const;

export const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({ isOpen, preselected, onClose }) => {
  const [files, setFiles] = useState<CsvFileInfo[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  /** Genau eine Datei pro Übernahme – nie mehrere. */
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<UploadTarget>(DEFAULT_UPLOAD_TARGET);
  const [status, setStatus] = useState<NuernbergspotsStatus | null>(null);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const loadStatus = useCallback(async (next: UploadTarget) => {
    setStatus(null);
    try {
      setStatus(await window.electronAPI.nuernbergspots.getStatus(next));
    } catch {
      setStatus({ target: next, connected: false });
    }
  }, []);

  // Beim Öffnen: frischer Zustand, Dateiliste laden, Voreinstellung Prod.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setTarget(DEFAULT_UPLOAD_TARGET);
    setPhase('form');
    setResult(null);
    setCopied(false);
    setEmail('');
    setPassword('');
    setFormError(null);
    setIsLoadingFiles(true);
    loadStatus(DEFAULT_UPLOAD_TARGET);

    window.electronAPI.csv
      .listFiles()
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        const known = new Set(list.map((f) => f.fileName));
        // Höchstens die erste bekannte Datei vorauswählen – nie mehrere.
        setSelected(preselected.find((name) => known.has(name)) ?? null);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFiles(false);
      });

    return () => {
      cancelled = true;
    };
    // `preselected` gilt nur beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSelectTarget = (next: UploadTarget) => {
    if (phase === 'uploading' || next === target) return;
    setTarget(next);
    setFormError(null);
    setPassword('');
    loadStatus(next);
  };

  const selectedEvents = useMemo(
    () => files.find((f) => f.fileName === selected)?.eventCount ?? 0,
    [files, selected]
  );

  const isConnected = status?.connected === true;
  const needsCredentials = status !== null && !isConnected;
  const canConfirm =
    phase === 'form' &&
    status !== null &&
    selected !== null &&
    (isConnected || (email.trim().length > 0 && password.length > 0));

  const handleLogout = async () => {
    try {
      await window.electronAPI.nuernbergspots.logout(target);
    } finally {
      await loadStatus(target);
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setFormError(null);

    // 1. Falls für diese Stage noch niemand angemeldet ist: zuerst anmelden.
    if (!isConnected) {
      setPhase('uploading');
      try {
        const login = await window.electronAPI.nuernbergspots.login({ target, email, password });
        if (!login.success) {
          setFormError(login.error || 'Die Anmeldung hat nicht geklappt.');
          setPhase('form');
          return;
        }
      } catch (err: any) {
        setFormError(err?.message || 'Die Anmeldung hat nicht geklappt.');
        setPhase('form');
        return;
      } finally {
        // Das Passwort bleibt in keinem Fall im Formular stehen.
        setPassword('');
      }
    }

    // 2. Hochladen – in der Reihenfolge der Dateiliste.
    setPhase('uploading');
    setResult(null);
    setCopied(false);
    const fileNames = selected ? [selected] : [];
    try {
      setResult(await window.electronAPI.nuernbergspots.upload({ target, fileNames }));
    } catch (err: any) {
      setResult({
        target,
        success: false,
        created: 0,
        duplicates: 0,
        failed: 0,
        totalRows: 0,
        files: [],
        errorKind: 'server',
        error: 'Beim Übertragen ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
        detailsForDomi: `=== Details für Domi ===\nZeitpunkt: ${new Date().toISOString()}\nAktion: Upload zu Nürnbergspots\nStage: ${UPLOAD_TARGET_LABELS[target]}\nFehler: ${err?.message || String(err)}\n========================`,
      });
    }
    setPhase('result');
    loadStatus(target);
  };

  const summary = result ? summarizeUpload(result) : null;

  const handleCopyDetails = async () => {
    if (!result?.detailsForDomi) return;
    await window.electronAPI.clipboard.writeText(result.detailsForDomi);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleClose = () => {
    if (phase === 'uploading') return;
    onClose();
  };

  const backLabel =
    summary?.action === 'login' ? 'Neu anmelden' : summary?.action === 'retry' ? 'Noch einmal versuchen' : 'Zurück';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="upload-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans"
        >
          <motion.div
            key="upload-panel"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-label="In Nürnbergspots übernehmen"
            className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <CloudUpload className="w-4 h-4 text-foreground" />
                <h2 className="text-sm font-bold text-foreground">In Nürnbergspots übernehmen</h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={phase === 'uploading'}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40"
                aria-label="Schließen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Formular: Datei, Stage, Zugang */}
              {phase !== 'result' && (
                <>
                  {/* 1. Dateien */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">1. Datei wählen</h3>

                    {isLoadingFiles ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Lese Dateien...</span>
                      </div>
                    ) : files.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3">
                        Im Ausgabeordner liegen noch keine Dateien. Starte zuerst einen Terminabruf.
                      </p>
                    ) : (
                      <ul role="radiogroup" aria-label="Datei" className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {files.map((file) => (
                          <li key={file.fileName}>
                            <label
                              className={cn(
                                'flex items-center gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors',
                                selected === file.fileName
                                  ? 'border-foreground/40 bg-muted/70'
                                  : 'border-border bg-background hover:bg-muted/40'
                              )}
                            >
                              <input
                                type="radio"
                                name="upload-file"
                                checked={selected === file.fileName}
                                onChange={() => setSelected(file.fileName)}
                                disabled={phase === 'uploading'}
                                className="shrink-0"
                              />
                              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate font-semibold text-foreground" title={file.fileName}>
                                {file.fileName}
                              </span>
                              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground font-mono">
                                {file.eventCount} {file.eventCount === 1 ? 'Event' : 'Events'}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    {files.length > 0 && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Es wird immer nur eine Datei auf einmal hochgeladen. Weitere Dateien lädst du danach nacheinander
                        hoch, indem du den Dialog erneut öffnest.
                      </p>
                    )}
                  </section>

                  {/* 2. Stage */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">2. Stage wählen</h3>
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
                            disabled={phase === 'uploading'}
                            className={cn(
                              'px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60',
                              active
                                ? option === 'prod'
                                  ? 'bg-secondary text-secondary-foreground shadow-2xs'
                                  : 'bg-background text-foreground border border-border shadow-2xs'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {UPLOAD_TARGET_LABELS[option]}
                          </button>
                        );
                      })}
                    </div>
                    <p
                      className={cn(
                        'text-[11px] leading-relaxed',
                        target === 'prod' ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {TARGET_HINTS[target]}
                    </p>
                  </section>

                  {/* 3. Zugang */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">3. Zugang</h3>

                    {status === null ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Prüfe Anmeldung...</span>
                      </div>
                    ) : isConnected ? (
                      <div className="p-3 rounded-xl flex items-center justify-between gap-3 border border-success/30 bg-success/10 text-xs">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <span className="font-semibold block text-foreground">
                              Verbunden mit {UPLOAD_TARGET_LABELS[target]}
                            </span>
                            <p className="text-muted-foreground truncate" title={status.email}>
                              Angemeldet als {status.email}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleLogout}
                          disabled={phase === 'uploading'}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border bg-background hover:bg-muted rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Abmelden</span>
                        </button>
                      </div>
                    ) : (
                      needsCredentials && (
                        <div className="space-y-2.5">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Für {UPLOAD_TARGET_LABELS[target]} bist du noch nicht angemeldet. Dein Passwort wird nicht
                            gespeichert – nur eine verschlüsselte Anmeldung im macOS-Schlüsselbund.
                          </p>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="E-Mail"
                            autoComplete="username"
                            disabled={phase === 'uploading'}
                            className={cn(inputPreset, 'w-full px-3 py-2 text-xs')}
                          />
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Passwort"
                            autoComplete="current-password"
                            disabled={phase === 'uploading'}
                            className={cn(inputPreset, 'w-full px-3 py-2 text-xs')}
                          />
                        </div>
                      )
                    )}

                    {formError && (
                      <div className="p-2.5 rounded-lg text-xs flex items-center gap-2 border border-destructive/30 bg-destructive/10 text-destructive">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{formError}</span>
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* Ergebnis: die Antwort des Imports, wie im Admin-Frontend */}
              {phase === 'result' && summary && (
                <motion.div
                  key="upload-result"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.soft}
                  className="space-y-3"
                >
                  <div className={cn('rounded-xl border p-3.5 text-xs space-y-1.5', TONE_BOX[summary.tone])}>
                    <div className="flex items-start gap-2">
                      {summary.tone === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      ) : summary.tone === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      ) : (
                        <AlertOctagon className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground block">{summary.headline}</span>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                          {summary.stageLabel}
                        </span>
                      </div>
                    </div>
                    {summary.lines.map((line) => (
                      <p key={line} className="text-muted-foreground leading-relaxed pl-6">
                        {line}
                      </p>
                    ))}
                    {summary.offerDetails && (
                      <button
                        type="button"
                        onClick={handleCopyDetails}
                        className="ml-6 inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground hover:underline cursor-pointer"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>In Zwischenablage kopiert!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Details für Domi kopieren</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {summary.counts && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">{summary.counts.totalRows} Zeilen verarbeitet</p>
                      <div className="grid grid-cols-3 gap-2">
                        <CountCard
                          icon={<CheckCircle2 className="w-5 h-5 text-success" />}
                          value={summary.counts.created}
                          label="Erfolgreich"
                          active={summary.counts.created > 0}
                          activeClass="border-success/40 bg-success/5"
                        />
                        <CountCard
                          icon={<AlertTriangle className="w-5 h-5 text-warning" />}
                          value={summary.counts.duplicates}
                          label="Duplikate"
                          active={summary.counts.duplicates > 0}
                          activeClass="border-warning/40 bg-warning/5"
                        />
                        <CountCard
                          icon={<XCircle className="w-5 h-5 text-destructive" />}
                          value={summary.counts.failed}
                          label="Fehlgeschlagen"
                          active={summary.counts.failed > 0}
                          activeClass="border-destructive/40 bg-destructive/5"
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {phase === 'uploading' && (
                <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-xs text-foreground flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span className="font-medium">
                    Termine werden zu {UPLOAD_TARGET_LABELS[target]} übertragen...
                  </span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-end gap-2">
              {phase === 'result' ? (
                <>
                  <motion.button
                    type="button"
                    {...{ whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 }, transition: spring.snappy }}
                    onClick={() => setPhase('form')}
                    className={cn(buttonPreset, 'px-3 py-1.5 text-xs font-medium cursor-pointer')}
                  >
                    {backLabel}
                  </motion.button>
                  <motion.button
                    type="button"
                    {...{ whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 }, transition: spring.snappy }}
                    onClick={onClose}
                    className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 text-xs font-semibold rounded-xl border border-secondary transition-colors cursor-pointer shadow-2xs"
                  >
                    Fertig
                  </motion.button>
                </>
              ) : (
                <>
                  <motion.button
                    type="button"
                    {...{ whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 }, transition: spring.snappy }}
                    onClick={handleClose}
                    disabled={phase === 'uploading'}
                    className={cn(buttonPreset, 'px-3 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-40')}
                  >
                    Abbrechen
                  </motion.button>
                  <motion.button
                    type="button"
                    {...{ whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 }, transition: spring.snappy }}
                    onClick={handleConfirm}
                    disabled={!canConfirm}
                    className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 text-xs font-semibold rounded-xl border border-secondary transition-colors cursor-pointer shadow-2xs"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>
                      Upload bestätigen
                      {selected !== null ? ` (${selectedEvents} ${selectedEvents === 1 ? 'Event' : 'Events'})` : ''}
                    </span>
                  </motion.button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const CountCard: React.FC<{
  icon: React.ReactNode;
  value: number;
  label: string;
  active: boolean;
  activeClass: string;
}> = ({ icon, value, label, active, activeClass }) => (
  <div className={cn('rounded-xl border p-3 flex items-center gap-2.5', active ? activeClass : 'border-border')}>
    <div className="shrink-0">{icon}</div>
    <div className="min-w-0">
      <p className="text-lg font-bold text-foreground font-mono leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1 truncate">{label}</p>
    </div>
  </div>
);
