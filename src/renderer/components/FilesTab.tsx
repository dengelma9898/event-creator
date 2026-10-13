import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  Calendar,
  HardDrive,
  Clock,
  ArrowRight,
  Loader2,
  FileText,
  CloudUpload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import type { CsvFileInfo, CsvEventRecord, DeleteOutcome, EditOutcome, EventChanges } from '../../shared/types.js';
import { EventListView } from './EventListView.js';
import { AnimatedCounter } from './ui/AnimatedCounter.js';
import { cardPreset, buttonPreset, inputPreset } from '../lib/designTokens.js';
import { Badge } from './ui/Badge.js';
import { cn } from '../lib/utils.js';
import { spring, fadeUpVariants, scalePopVariants, tapHover } from '../lib/motion.js';

interface FilesTabProps {
  onNavigateToScrape: () => void;
  /** Öffnet den Upload-Dialog (Datei, Stage, Zugang, Bestätigung) mit diesen Dateien vorausgewählt. */
  onRequestUpload: (fileNames: string[]) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const FilesTab: React.FC<FilesTabProps> = ({ onNavigateToScrape, onRequestUpload }) => {
  const [files, setFiles] = useState<CsvFileInfo[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string>('all');
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(true);
  const [events, setEvents] = useState<CsvEventRecord[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');

  // 1. Dateien auflisten
  const loadFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const list = await window.electronAPI.csv.listFiles();
      setFiles(list);
    } catch (err: any) {
      console.error('Fehler beim Laden der CSV-Dateien:', err);
      setFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  // 2. Events laden für ausgewählte Datei(en)
  const loadEventsForSelection = useCallback(
    async (fileNameSelection: string, currentFiles: CsvFileInfo[]) => {
      setIsLoadingEvents(true);
      try {
        const namesToLoad =
          fileNameSelection === 'all' ? currentFiles.map((f) => f.fileName) : [fileNameSelection];

        if (namesToLoad.length === 0) {
          setEvents([]);
        } else {
          const list = await window.electronAPI.csv.loadEvents(namesToLoad);
          setEvents(list);
        }
      } catch (err) {
        console.error('Fehler beim Laden der Events:', err);
        setEvents([]);
      } finally {
        setIsLoadingEvents(false);
      }
    },
    []
  );

  // Initialer Ladevorgang
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Wenn sich die Dateiliste oder die Dateiauswahl ändert, Events nachladen
  useEffect(() => {
    if (!isLoadingFiles) {
      loadEventsForSelection(selectedFileName, files);
    }
  }, [selectedFileName, files, isLoadingFiles, loadEventsForSelection]);

  // Gesamtzahl Events über alle Dateien
  const totalEvents = useMemo(() => {
    return files.reduce((acc, f) => acc + f.eventCount, 0);
  }, [files]);

  // Gefilterte Dateien nach Dateinamen-Suche
  const filteredFiles = useMemo(() => {
    const q = fileSearchQuery.toLowerCase().trim();
    if (!q) return files;
    return files.filter((f) => f.fileName.toLowerCase().includes(q));
  }, [files, fileSearchQuery]);

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.shell.openDataFolder();
    } catch (err) {
      console.warn('Konnte Ausgabeordner nicht öffnen:', err);
    }
  };

  const handleShowInFinder = async (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.shell.showInFolder(fileName);
    } catch (err) {
      console.warn('Konnte Datei nicht im Finder anzeigen:', err);
    }
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
        const updatedFiles = await window.electronAPI.csv.listFiles();
        setFiles(updatedFiles);
        await loadEventsForSelection(selectedFileName, updatedFiles);
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
        const updatedFiles = await window.electronAPI.csv.listFiles();
        setFiles(updatedFiles);
        await loadEventsForSelection(selectedFileName, updatedFiles);
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

  return (
    <div className="max-w-4xl mx-auto space-y-6 font-sans">
      {/* Header & Aktionen */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
            <span>Gespeicherte Dateien</span>
            {files.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-semibold">
                {files.length} {files.length === 1 ? 'Datei' : 'Dateien'}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Übersicht aller erzeugten CSV-Dateien im offiziellen Ausgabeordner <code className="text-foreground font-semibold">data/</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={spring.snappy}
            onClick={() => onRequestUpload(selectedFileName === 'all' ? [] : [selectedFileName])}
            disabled={isLoadingFiles || files.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary shadow-2xs cursor-pointer disabled:opacity-40"
            title="Eine CSV-Datei zu Test oder Prod hochladen (immer nur eine pro Durchgang)"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            <span>In Nürnbergspots übernehmen</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={spring.snappy}
            onClick={handleOpenFolder}
            className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer')}
            title="Ordner data/ im macOS Finder öffnen"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>data/ im Finder öffnen</span>
          </motion.button>

          <motion.button
            type="button"
            {...tapHover.iconButton}
            onClick={loadFiles}
            disabled={isLoadingFiles}
            className={cn(buttonPreset, 'p-2 flex items-center justify-center cursor-pointer disabled:opacity-40')}
            title="Dateiliste aktualisieren"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 text-foreground', isLoadingFiles && 'animate-spin')} />
          </motion.button>
        </div>
      </div>

      {/* Ladezustand */}
      {isLoadingFiles && (
        <motion.div
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className={cn(cardPreset, 'p-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2')}
        >
          <Loader2 className="w-4 h-4 animate-spin text-tertiary" />
          <span>Lese Dateien aus dem Ausgabeordner...</span>
        </motion.div>
      )}

      {/* Leerer Zustand (keine Dateien im Ordner) */}
      {!isLoadingFiles && files.length === 0 && (
        <motion.div
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className={cn(cardPreset, 'p-10 text-center space-y-4')}
        >
          <motion.div
            variants={scalePopVariants}
            initial="hidden"
            animate="visible"
            className="w-12 h-12 rounded-full bg-secondary/10 border border-border flex items-center justify-center mx-auto text-foreground"
          >
            <FileSpreadsheet className="w-6 h-6 text-foreground" />
          </motion.div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-sm font-bold text-foreground">Noch keine CSV-Dateien vorhanden</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Im Ausgabeordner <code className="text-foreground">data/</code> liegen aktuell noch keine CSV-Dateien.
              Starte im Bereich &bdquo;Termine abrufen&ldquo; einen Lauf für eine Webseite, um neue Termine zu erfassen.
            </p>
          </div>
          <div className="pt-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring.snappy}
              onClick={onNavigateToScrape}
              className="inline-flex items-center gap-2 py-2 px-4 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary font-semibold text-xs shadow-2xs cursor-pointer"
            >
              <span>Zu &bdquo;Termine abrufen&ldquo; wechseln</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Dateien-Kacheln & Event-Vorschau */}
      {!isLoadingFiles && files.length > 0 && (
        <div className="space-y-6">
          {/* Status-Karten / Kennzahlen mit animiertem Count-up */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <motion.div
              whileHover={{ y: -2 }}
              transition={spring.snappy}
              className={cn(cardPreset, 'p-4 flex items-center justify-between')}
            >
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Gespeicherte Dateien
                </span>
                <p className="text-xl font-bold text-foreground font-mono">
                  <AnimatedCounter value={files.length} />
                </p>
              </div>
              <FileSpreadsheet className="w-6 h-6 text-muted-foreground/60" />
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              transition={spring.snappy}
              className={cn(cardPreset, 'p-4 flex items-center justify-between')}
            >
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Gesamte Termine
                </span>
                <p className="text-xl font-bold text-foreground font-mono">
                  <AnimatedCounter value={totalEvents} />
                </p>
              </div>
              <Calendar className="w-6 h-6 text-muted-foreground/60" />
            </motion.div>
          </div>

          {/* Dateiauswahl-Bereich */}
          <div className={cn(cardPreset, 'p-4 space-y-3')}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Dateiauswahl ({filteredFiles.length} von {files.length})
              </span>

              {files.length > 3 && (
                <input
                  type="text"
                  placeholder="Dateiname filtern..."
                  value={fileSearchQuery}
                  onChange={(e) => setFileSearchQuery(e.target.value)}
                  className={cn(inputPreset, 'py-1 px-2.5 text-xs w-full sm:w-52')}
                />
              )}
            </div>

            {/* Klickbare Dateikarten */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
              {/* Option: Alle Dateien */}
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                transition={spring.snappy}
                onClick={() => setSelectedFileName('all')}
                className={cn(
                  'text-left p-3 rounded-xl border transition-colors cursor-pointer flex items-center justify-between',
                  selectedFileName === 'all'
                    ? 'border-foreground/40 bg-muted/70 ring-1 ring-foreground/20'
                    : 'border-border bg-background hover:bg-muted/40'
                )}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-foreground truncate">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-foreground" />
                    <span>Alle Dateien anzeigen</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Kombinierte Ansicht aller {totalEvents} Termine
                  </span>
                </div>
                {selectedFileName === 'all' && (
                  <Badge variant="default" className="text-[10px] shrink-0">
                    Aktiv
                  </Badge>
                )}
              </motion.button>

              {/* Individuelle Dateien */}
              <AnimatePresence>
                {filteredFiles.map((file) => {
                  const isSelected = selectedFileName === file.fileName;
                  return (
                    <motion.div
                      layout
                      key={file.fileName}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.99 }}
                      transition={spring.snappy}
                      onClick={() => setSelectedFileName(file.fileName)}
                      className={cn(
                        'text-left p-3 rounded-xl border transition-colors cursor-pointer flex items-center justify-between group',
                        isSelected
                          ? 'border-foreground/40 bg-muted/70 ring-1 ring-foreground/20'
                          : 'border-border bg-background hover:bg-muted/40'
                      )}
                    >
                      <div className="min-w-0 pr-2 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-foreground truncate">
                          <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                          <span className="truncate" title={file.fileName}>
                            {file.fileName}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3" />
                            {formatBytes(file.sizeBytes)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(file.lastModified)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {file.eventCount} {file.eventCount === 1 ? 'Event' : 'Events'}
                        </Badge>
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.9 }}
                          transition={spring.snappy}
                          onClick={(e) => handleShowInFinder(file.fileName, e)}
                          className="p-1 rounded hover:bg-secondary/20 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="Im macOS Finder anzeigen"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Event-Liste für die ausgewählte Datei / alle Dateien */}
          <div className="space-y-3 pt-2">
            <EventListView
              events={events}
              onDeleteEvent={handleDeleteEvent}
              onUpdateEvent={handleUpdateEvent}
              isLoading={isLoadingEvents}
            />
          </div>
        </div>
      )}
    </div>
  );
};
