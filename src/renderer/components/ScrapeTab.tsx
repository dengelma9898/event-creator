import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  FolderOpen,
  Copy,
  Check,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  Loader2,
  Sparkles,
  Info,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import type {
  CsvEventRecord,
  DeleteOutcome,
  EditOutcome,
  EventChanges,
  PlanItem,
  RunPhase,
  RunStatusUpdate,
  SkillMetadata,
  SourceStatusInfo,
  StepperStep,
  StepperStepId,
} from '../../shared/types.js';
import { createInitialStepperSteps } from '../../shared/types.js';
import { CancelModal } from './CancelModal.js';
import { EventListView } from './EventListView.js';
import { RunProgressStepper } from './ui/RunProgressStepper.js';
import { SourceSelect } from './ui/SourceSelect.js';
import { SourceStatusCard } from './ui/SourceStatusCard.js';
import { AnimatedCounter } from './ui/AnimatedCounter.js';
import { ConfettiBurst } from './ui/ConfettiBurst.js';
import { playCompletionSound } from '../lib/sound.js';
import { cardPreset, buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { spring, fadeUpVariants, tapHover, scalePopVariants } from '../lib/motion.js';

interface ScrapeTabProps {
  skills: SkillMetadata[];
  selectedSkillId: string;
  onSelectSkill: (id: string) => void;
  onRefreshSkills: () => void;
}

export const ScrapeTab: React.FC<ScrapeTabProps> = ({
  skills,
  selectedSkillId,
  onSelectSkill,
  onRefreshSkills,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [eventsFound, setEventsFound] = useState<number>(0);
  const [newEventsCount, setNewEventsCount] = useState<number>(0);
  const [existingEventsCount, setExistingEventsCount] = useState<number>(0);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [detailsForDomiText, setDetailsForDomiText] = useState<string>('');
  const [copiedDetails, setCopiedDetails] = useState<boolean>(false);
  const [showConfetti, setShowConfetti] = useState<boolean>(false);

  // CSV Events Anzeige
  const [loadedEvents, setLoadedEvents] = useState<CsvEventRecord[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);

  // Quell-Statusse (Bereich 2: Vor dem Abruf)
  const [statuses, setStatuses] = useState<Record<string, SourceStatusInfo>>({});
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);

  // Stepper & Prozess-Transparenz (Bereich 3)
  const [stepperSteps, setStepperSteps] = useState<StepperStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<StepperStepId | undefined>();
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Abbruchmodal-Steuerung
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // Live-Laufzeittimer während des Abrufs
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRunning) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remSecs = sec % 60;
    return `${mins}:${remSecs.toString().padStart(2, '0')} Min.`;
  };

  const loadCsvEvents = async (names: string[]) => {
    setIsLoadingEvents(true);
    try {
      const list = await window.electronAPI.csv.loadEvents(names);
      setLoadedEvents(list);
    } catch (err) {
      console.error('Fehler beim Laden der CSV-Events:', err);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const loadStatuses = async () => {
    setIsLoadingStatus(true);
    try {
      if (window.electronAPI.skills.getAllStatuses) {
        const res = await window.electronAPI.skills.getAllStatuses();
        setStatuses(res || {});
      }
    } catch (err) {
      console.error('Fehler beim Laden der Quellstatusse:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatuses();
  }, [skills]);

  const handleRefresh = async () => {
    onRefreshSkills();
    await loadStatuses();
  };

  // Status-Listener registrieren
  useEffect(() => {
    const unsubscribe = window.electronAPI.runner.onStatusUpdate((update: RunStatusUpdate) => {
      setPhase(update.phase);
      setStatusMessage(update.message);
      setEventsFound(update.eventsFound);
      setNewEventsCount(update.newEventsCount);
      setExistingEventsCount(update.existingEventsCount);
      setFileNames(update.fileNames);

      if (update.liveEvents && update.liveEvents.length > 0) {
        setLoadedEvents(update.liveEvents);
      }

      if (update.detailsForDomi?.formattedText) {
        setDetailsForDomiText(update.detailsForDomi.formattedText);
      }

      if (update.stepperSteps && update.stepperSteps.length > 0) {
        setStepperSteps(update.stepperSteps);
      }
      if (update.activeStepId) {
        setActiveStepId(update.activeStepId);
      }
      if (update.planItems) {
        setPlanItems(update.planItems);
      }

      if (update.phase === 'completed') {
        setIsRunning(false);
        setIsCancelling(false);
        setIsCancelModalOpen(false);
        setShowConfetti(true);
        playCompletionSound();
        loadCsvEvents(update.fileNames);
        loadStatuses();
      } else if (update.phase === 'failed' || update.phase === 'cancelled') {
        setIsRunning(false);
        setIsCancelling(false);
        setIsCancelModalOpen(false);
        if (update.fileNames && update.fileNames.length > 0) {
          loadCsvEvents(update.fileNames);
        }
        loadStatuses();
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleStart = async () => {
    if (!selectedSkillId || isRunning) return;

    setIsRunning(true);
    setPhase('preparing');
    setStatusMessage('Terminabruf wird vorbereitet...');
    setEventsFound(0);
    setNewEventsCount(0);
    setExistingEventsCount(0);
    setFileNames([]);
    setDetailsForDomiText('');
    setCopiedDetails(false);
    setShowConfetti(false);
    setLoadedEvents([]);
    setIsLoadingEvents(false);

    // Initialer Stepper für sofortiges visuelles Feedback
    const domainText = selectedSkill?.domain || 'der Webseite';
    setStepperSteps(createInitialStepperSteps(domainText));
    setActiveStepId('check_inventory');
    setPlanItems([]);

    try {
      const result = await window.electronAPI.runner.start(selectedSkillId);
      if (!result.success) {
        setIsRunning(false);
        setPhase('failed');
        setStatusMessage('Hier hat etwas nicht geklappt. Frag Domi wie das geht.');
        setDetailsForDomiText(
          `=== Details für Domi ===\nZeitpunkt: ${new Date().toISOString()}\nQuelle: ${selectedSkillId}\nFehler: ${result.error || 'Unbekannter Startfehler'}\n========================`
        );
      }
    } catch (err: any) {
      setIsRunning(false);
      setPhase('failed');
      setStatusMessage('Hier hat etwas nicht geklappt. Frag Domi wie das geht.');
      setDetailsForDomiText(
        `=== Details für Domi ===\nZeitpunkt: ${new Date().toISOString()}\nQuelle: ${selectedSkillId}\nFehler: ${err?.message || String(err)}\n========================`
      );
    }
  };

  const handleConfirmCancel = async () => {
    setIsCancelling(true);
    try {
      await window.electronAPI.runner.cancel();
    } catch {
      // ignore
    } finally {
      setIsCancelling(false);
      setIsCancelModalOpen(false);
    }
  };

  const handleShowInFinder = async () => {
    if (fileNames.length > 0) {
      await window.electronAPI.shell.showInFolder(fileNames[0]);
    } else {
      await window.electronAPI.shell.openDataFolder();
    }
  };

  const handleCopyDetails = async () => {
    if (!detailsForDomiText) return;
    await window.electronAPI.clipboard.writeText(detailsForDomiText);
    setCopiedDetails(true);
    setTimeout(() => {
      setCopiedDetails(false);
    }, 2500);
  };

  const handleReset = () => {
    setPhase('idle');
    setStatusMessage('');
    setEventsFound(0);
    setNewEventsCount(0);
    setExistingEventsCount(0);
    setFileNames([]);
    setDetailsForDomiText('');
    setCopiedDetails(false);
    setShowConfetti(false);
    setLoadedEvents([]);
    setPlanItems([]);
    setIsLoadingEvents(false);
  };

  const handleDeleteEvent = async (event: CsvEventRecord): Promise<DeleteOutcome> => {
    try {
      const res = await window.electronAPI.csv.deleteEvent({
        fileName: event.fileName,
        rowIndex: event.rowIndex,
        expectedTitle: event.title,
        expectedDetailUrl: event.detailUrl,
        expectedStartDate: event.startDate,
      });

      if (res.success) {
        const namesToLoad = fileNames.length > 0 ? fileNames : [event.fileName];
        const updated = await window.electronAPI.csv.loadEvents(namesToLoad);
        setLoadedEvents(updated);
        loadStatuses();

        setEventsFound((prev) => Math.max(0, prev - 1));
        if (newEventsCount > 0) {
          setNewEventsCount((prev) => Math.max(0, prev - 1));
        } else if (existingEventsCount > 0) {
          setExistingEventsCount((prev) => Math.max(0, prev - 1));
        }

        return { success: true, notice: res.notice };
      } else {
        return {
          success: false,
          error: res.error || 'Event konnte nicht gelöscht werden.',
          fileUnchanged: res.fileUnchanged !== false,
        };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Unerwarteter Fehler beim Löschen.', fileUnchanged: false };
    }
  };

  const handleUpdateEvent = async (
    event: CsvEventRecord,
    changes: EventChanges
  ): Promise<EditOutcome> => {
    try {
      const res = await window.electronAPI.csv.updateEvent({
        fileName: event.fileName,
        rowIndex: event.rowIndex,
        expectedTitle: event.title,
        expectedDetailUrl: event.detailUrl,
        expectedStartDate: event.startDate,
        changes,
      });

      if (res.success) {
        const namesToLoad = fileNames.length > 0 ? fileNames : [event.fileName];
        const updated = await window.electronAPI.csv.loadEvents(namesToLoad);
        setLoadedEvents(updated);
        loadStatuses();
        return { success: true, notice: res.notice };
      } else {
        return {
          success: false,
          error: res.error || 'Event konnte nicht aktualisiert werden.',
          fileUnchanged: res.fileUnchanged !== false,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Unerwarteter Fehler beim Aktualisieren.',
        fileUnchanged: false,
      };
    }
  };

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  return (
    <div className="max-w-2xl mx-auto space-y-6 font-sans">
      {/* Feier-Moment bei erfolgreichem Scrape */}
      {showConfetti && <ConfettiBurst onComplete={() => setShowConfetti(false)} />}

      {/* Intro */}
      <div>
        <h1 className="text-base sm:text-lg font-bold text-foreground tracking-tight">Termine abrufen</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Wähle genau eine Quelle aus, um aktuelle Veranstaltungsdaten automatisiert in den Ausgabeordner zu erfassen.
        </p>
      </div>

      {/* Main Action Card */}
      <div className={cn(cardPreset, 'p-6 space-y-6')}>
        <div>
          <label
            htmlFor="venue-select"
            className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2"
          >
            Welche Webseite möchtest du durchsuchen?
          </label>
          <div className="flex gap-2">
            <SourceSelect
              skills={skills}
              selectedSkillId={selectedSkillId}
              onSelect={onSelectSkill}
              statuses={statuses}
              disabled={isRunning}
            />
            <motion.button
              type="button"
              {...tapHover.iconButton}
              onClick={handleRefresh}
              disabled={isRunning}
              title="Quellenliste aktualisieren"
              className={cn(
                buttonPreset,
                'p-2.5 shrink-0 flex items-center justify-center rounded-xl disabled:opacity-40 cursor-pointer'
              )}
            >
              <RefreshCw className={cn('w-4 h-4 text-foreground', isLoadingStatus && 'animate-spin')} />
            </motion.button>
          </div>
          {selectedSkill?.description && (
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed italic line-clamp-2">
              {selectedSkill.description}
            </p>
          )}
        </div>

        {/* Statuskarte vor dem Abruf */}
        {selectedSkill && (
          <SourceStatusCard
            skill={selectedSkill}
            status={statuses[selectedSkill.id] || null}
            isLoading={isLoadingStatus && !statuses[selectedSkill.id]}
          />
        )}

        {/* Zustandskarten mit flüssiger AnimatePresence */}
        <AnimatePresence mode="wait">
          {/* Phase 1: Vor dem Start (Idle oder Cancelled) */}
          {!isRunning && (phase === 'idle' || phase === 'cancelled') && selectedSkill && (
            <motion.div
              key="idle"
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="space-y-4"
            >
              {/* Cancelled Banner falls kurz zuvor abgebrochen */}
              {phase === 'cancelled' && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs text-foreground flex items-center justify-between">
                  <span>{statusMessage || 'Vorgang beendet. Bestehende Daten blieben erhalten.'}</span>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs font-semibold text-foreground hover:underline ml-3 shrink-0 cursor-pointer"
                  >
                    Zurücksetzen
                  </button>
                </div>
              )}

              {/* Ablauf-Vorschau vor dem Start */}
              <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Geplanter Ablauf (4 Schritte)
                </span>
                <RunProgressStepper
                  steps={createInitialStepperSteps(selectedSkill.domain).map((s) => ({
                    ...s,
                    status: 'pending',
                    detail: undefined,
                  }))}
                />
              </div>

              {/* Start Button */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                transition={spring.snappy}
                onClick={handleStart}
                disabled={isRunning || !selectedSkillId}
                className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary font-semibold text-xs shadow-2xs hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Termine jetzt abrufen (Dauert ca. 1–2 Min.)</span>
              </motion.button>
            </motion.div>
          )}

          {/* Phase 2: Running Status Card */}
          {isRunning && (
            <motion.div
              key="running"
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center shrink-0 shadow-2xs">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Abruf läuft aktiv
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded-md border border-border">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        {formatElapsed(elapsedSeconds)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground mt-0.5">
                      {statusMessage || 'Verarbeite Termine...'}
                    </p>
                  </div>
                </div>

                {/* Stop Button */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring.snappy}
                  onClick={() => setIsCancelModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-destructive border border-destructive/30 bg-background hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  <Square className="w-3 h-3 fill-destructive" />
                  <span>Abbrechen</span>
                </motion.button>
              </div>

              {/* 4-Phasen-Stepper */}
              {stepperSteps.length > 0 && (
                <div className="pt-2 border-t border-border/80">
                  <RunProgressStepper
                    steps={stepperSteps}
                    activeStepId={activeStepId}
                    planItems={planItems}
                  />
                </div>
              )}

              {/* Beruhigender Zeithorizont-Hinweis */}
              <div className="rounded-xl bg-muted/40 border border-border p-3.5 text-xs text-muted-foreground flex items-start gap-3">
                <Info className="w-4 h-4 text-foreground/80 shrink-0 mt-0.5" />
                <div className="space-y-1 leading-relaxed">
                  <p className="font-semibold text-foreground">
                    Hinweis: Das gründliche Erfassen aller Details und Unterseiten dauert meist 1 bis 2 Minuten.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Du kannst dieses Fenster einfach im Hintergrund geöffnet lassen oder zu anderen Programmen wechseln. Du erhältst automatisch eine Benachrichtigung, sobald alles fertig ist.
                  </p>
                </div>
              </div>

              {/* Live-Event-Zähler mit flüssiger animierter Ziffer */}
              <div className="bg-muted/30 rounded-xl p-3 border border-border flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-tertiary" />
                  <span className="font-medium text-foreground">Live gefundene Termine:</span>
                </div>
                <div className="flex items-center gap-2">
                  <AnimatedCounter
                    value={eventsFound}
                    className="text-base font-bold text-foreground font-mono"
                  />
                  <span className="text-xs text-muted-foreground">gesamt</span>
                  <AnimatePresence>
                    {(newEventsCount > 0 || existingEventsCount > 0) && (
                      <div className="flex items-center gap-1.5 ml-2">
                        {newEventsCount > 0 && (
                          <motion.span
                            key="new-count"
                            variants={scalePopVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="border border-success/30 bg-success/15 text-success font-semibold text-[11px] px-2 py-0.5 rounded-md"
                          >
                            +{newEventsCount} neu
                          </motion.span>
                        )}
                        {existingEventsCount > 0 && (
                          <span className="border border-border bg-muted/60 text-muted-foreground font-medium text-[11px] px-2 py-0.5 rounded-md">
                            {existingEventsCount} im Bestand
                          </span>
                        )}
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

          {/* Phase 3: Success Card */}
          {phase === 'completed' && !isRunning && (
            <motion.div
              key="completed"
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="rounded-xl border border-success/30 bg-card p-5 space-y-4 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <motion.div
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={spring.bouncy}
                  className="shrink-0 mt-0.5"
                >
                  <CheckCircle2 className="w-5 h-5 text-success" />
                </motion.div>
                <div className="space-y-1">
                  <h3 className="text-xs sm:text-sm font-bold text-foreground">
                    Terminabruf erfolgreich abgeschlossen!
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    {statusMessage}
                  </p>
                  {(newEventsCount > 0 || existingEventsCount > 0) && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={spring.soft}
                      className="flex items-center gap-2 pt-1 text-[11px]"
                    >
                      {newEventsCount > 0 && (
                        <span className="border border-success/30 bg-success/15 text-success font-semibold px-2 py-0.5 rounded-md">
                          +{newEventsCount} neue Termine
                        </span>
                      )}
                      {existingEventsCount > 0 && (
                        <span className="border border-border bg-muted/60 text-muted-foreground font-medium px-2 py-0.5 rounded-md">
                          {existingEventsCount} bestehende Termine
                        </span>
                      )}
                    </motion.div>
                  )}
                  {fileNames.length > 1 && (
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Aufgrund der Menge (&gt;50 Einträge) wurden {fileNames.length} übersichtliche CSV-Dateien angelegt.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  onClick={handleShowInFinder}
                  className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer')}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Datei im Finder anzeigen</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  onClick={handleReset}
                  className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Weiteren Abruf starten</span>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Phase 4: Error Card: "Frag Domi" */}
          {phase === 'failed' && !isRunning && (
            <motion.div
              key="failed"
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="rounded-xl border border-destructive/40 bg-card p-5 space-y-4 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={spring.bouncy}
                  className="shrink-0 mt-0.5"
                >
                  <AlertOctagon className="w-5 h-5 text-destructive" />
                </motion.div>
                <div className="space-y-1">
                  <h3 className="text-xs sm:text-sm font-bold text-foreground">
                    Hier hat etwas nicht geklappt.
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Frag Domi wie das geht. Er kann sich den Fehler kurz ansehen und beheben.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  onClick={handleCopyDetails}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-destructive hover:bg-destructive/90 rounded-lg transition-colors cursor-pointer shadow-2xs"
                >
                  {copiedDetails ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>In Zwischenablage kopiert!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Details für Domi kopieren</span>
                    </>
                  )}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  onClick={handleReset}
                  className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Erneut versuchen</span>
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generierte Events anzeigen & löschen (Inline-Karten mit Details) - live & nach Abschluss */}
        {loadedEvents.length > 0 && (
          <div className="space-y-3 pt-2">
            {isRunning && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring.soft}
                className="flex items-center justify-between text-xs font-semibold text-foreground px-3.5 py-2.5 bg-muted/40 rounded-xl border border-border"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
                  <span>Live erfasste Termine ({loadedEvents.length})</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  {newEventsCount > 0 && (
                    <span className="text-success font-semibold">
                      +{newEventsCount} neu
                    </span>
                  )}
                  {existingEventsCount > 0 && (
                    <span className="text-muted-foreground font-medium">
                      ({existingEventsCount} im Bestand)
                    </span>
                  )}
                  <span className="text-muted-foreground/60 hidden sm:inline">
                    • Sofortige Vorschau
                  </span>
                </div>
              </motion.div>
            )}
            <EventListView
              events={loadedEvents}
              onDeleteEvent={handleDeleteEvent}
              onUpdateEvent={handleUpdateEvent}
              editingDisabled={isRunning}
              isLoading={isLoadingEvents && loadedEvents.length === 0}
            />
          </div>
        )}
      </div>

      {/* Cancel Confirmation Dialog Modal */}
      <CancelModal
        isOpen={isCancelModalOpen}
        isCancelling={isCancelling}
        onConfirmCancel={handleConfirmCancel}
        onKeepRunning={() => setIsCancelModalOpen(false)}
      />
    </div>
  );
};
