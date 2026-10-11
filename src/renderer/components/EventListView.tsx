import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Tag,
  Ticket,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit3,
  Search,
  FileText,
  Mail,
  Phone,
  Globe,
  Share2,
  Loader2,
  AlertTriangle,
  X,
  Sparkles,
  AlertOctagon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import type { CsvEventRecord, DeleteOutcome, EditOutcome, EventChanges } from '../../shared/types.js';
import { assessEventQuality, isValidAddress } from '../../shared/event-quality.js';
import { EventDeleteModal } from './EventDeleteModal.js';
import { EventEditForm } from './EventEditForm.js';
import { Badge } from './ui/Badge.js';
import { cardPreset, inputPreset, buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';
import { spring, fadeUpVariants } from '../lib/motion.js';

interface EventListViewProps {
  events: CsvEventRecord[];
  onDeleteEvent: (event: CsvEventRecord) => Promise<DeleteOutcome>;
  onUpdateEvent?: (event: CsvEventRecord, changes: EventChanges) => Promise<EditOutcome>;
  isLoading?: boolean;
  editingDisabled?: boolean;
}

export const EventListView: React.FC<EventListViewProps> = ({
  events,
  onDeleteEvent,
  onUpdateEvent,
  isLoading = false,
  editingDisabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFileFilter, setSelectedFileFilter] = useState<string>('all');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Modal State
  const [eventToDelete, setEventToDelete] = useState<CsvEventRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLeftFileUntouched, setDeleteLeftFileUntouched] = useState(true);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Eindeutiger stabiler Schlüssel für ein Event
  const getEventKey = (ev: CsvEventRecord) => {
    return ev.fileName ? `${ev.fileName}#${ev.rowIndex}` : ev.id;
  };

  // Eindeutige Dateinamen für Dateifilter ermitteln
  const availableFiles = useMemo(() => {
    const fileSet = new Set<string>();
    events.forEach((ev) => {
      if (ev.fileName) fileSet.add(ev.fileName);
    });
    return Array.from(fileSet);
  }, [events]);

  // Gefilterte Events
  const filteredEvents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return events.filter((ev) => {
      if (selectedFileFilter !== 'all' && ev.fileName !== selectedFileFilter) {
        return false;
      }

      if (!query) return true;

      const titleMatch = ev.title.toLowerCase().includes(query);
      const descMatch = (ev.description || '').toLowerCase().includes(query);
      const locMatch = (ev.location || '').toLowerCase().includes(query);
      const catMatch = (ev.category || '').toLowerCase().includes(query);
      const dateMatch = (ev.startDate || '').toLowerCase().includes(query);

      return titleMatch || descMatch || locMatch || catMatch || dateMatch;
    });
  }, [events, searchQuery, selectedFileFilter]);

  // Aufteilung in Events mit unvollständiger Adresse (ungültig für Folgesystem) und gültige Events
  const { invalidEvents, validEvents } = useMemo(() => {
    const invalid: CsvEventRecord[] = [];
    const valid: CsvEventRecord[] = [];

    for (const ev of filteredEvents) {
      if (!isValidAddress(ev.location)) {
        invalid.push(ev);
      } else {
        valid.push(ev);
      }
    }

    return { invalidEvents: invalid, validEvents: valid };
  }, [filteredEvents]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleOpenLink = async (url: string) => {
    if (!url) return;
    try {
      await window.electronAPI.shell.openExternal(url);
    } catch (err) {
      console.warn('Konnte Link nicht im Browser öffnen:', err);
    }
  };

  const handleStartDelete = (ev: CsvEventRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteError(null);
    setDeleteLeftFileUntouched(true);
    setFeedbackNotice(null);
    setEventToDelete(ev);
  };

  const handleConfirmDelete = async () => {
    if (!eventToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    setFeedbackNotice(null);

    try {
      const res = await onDeleteEvent(eventToDelete);
      if (res.success) {
        setEventToDelete(null);
        setFeedbackNotice(res.notice ?? null);
      } else {
        setDeleteError(res.error || 'Fehler beim Löschen des Events.');
        setDeleteLeftFileUntouched(res.fileUnchanged !== false);
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Unerwarteter Fehler beim Löschen.');
      setDeleteLeftFileUntouched(false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (events.length === 0 && isLoading) {
    return (
      <div className={cn(cardPreset, 'p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2')}>
        <Loader2 className="w-4 h-4 animate-spin text-tertiary" />
        <span>Lade generierte CSV-Daten...</span>
      </div>
    );
  }

  if (events.length === 0 && !isLoading) {
    return null;
  }

  const renderEventCard = (event: CsvEventRecord, isInvalidSection = false) => {
    const key = getEventKey(event);
    const isExpanded = expandedKeys.has(key);
    const isEditing = editingKey === key;
    const quality = assessEventQuality(event);

    return (
      <motion.div
        layout
        key={key}
        variants={fadeUpVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={cn(
          cardPreset,
          'overflow-hidden transition-colors',
          isInvalidSection
            ? 'border-amber-500/40 bg-card hover:border-amber-500/60 shadow-2xs'
            : isExpanded
            ? 'border-foreground/30 shadow-xs'
            : 'hover:border-foreground/20'
        )}
      >
        {/* Event Card Header / Summary */}
        <div className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {event.isNew === true && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-success/15 text-success border border-success/30 shrink-0">
                  <Sparkles className="w-2.5 h-2.5" />
                  NEU
                </span>
              )}
              {event.isNew === false && (
                <span className="inline-flex items-center text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground border border-border shrink-0">
                  BESTAND
                </span>
              )}

              {/* Qualitäts-Badges */}
              {quality.hasInvalidAddress && (
                <span
                  title="Ort oder Straße fehlt. Ohne auffindbare Adresse hat das Event im Folgesystem keine Kartenposition."
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 shrink-0"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  Adresse unvollständig
                </span>
              )}

              {quality.hasNoTime && (
                <span
                  title="Keine Startzeit angegeben"
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0"
                >
                  <Clock className="w-2.5 h-2.5" />
                  Keine Zeit
                </span>
              )}

              {quality.hasNoImage && (
                <span
                  title="Kein Vorschaubild vorhanden"
                  className="inline-flex items-center text-[10px] font-normal px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/80 border border-border shrink-0"
                >
                  Kein Bild
                </span>
              )}

              <h3 className="text-xs sm:text-sm font-bold text-foreground leading-snug break-words">
                {event.title}
              </h3>
              {event.category && (
                <Badge variant="default" className="text-[10px] py-0 px-2 shrink-0">
                  <Tag className="w-2.5 h-2.5 mr-1" />
                  {event.category}
                </Badge>
              )}
              {event.price && (
                <Badge variant="outline" className="text-[10px] py-0 px-2 shrink-0 truncate max-w-[200px]">
                  {event.price}
                </Badge>
              )}
            </div>

            {/* Metadata Pill Row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-foreground/70" />
                <span>{event.startDate || 'Ohne Datum'}</span>
                {event.endDate && event.endDate !== event.startDate && (
                  <span>bis {event.endDate}</span>
                )}
              </div>

              {(event.startTime || event.endTime) && (
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-foreground/70" />
                  <span>
                    {event.startTime || ''}
                    {event.endTime ? ` – ${event.endTime}` : ''} Uhr
                  </span>
                </div>
              )}

              {event.location && (
                <div
                  className={cn(
                    'flex items-center gap-1.5 min-w-0',
                    quality.hasInvalidAddress && 'text-amber-700 dark:text-amber-400 font-medium'
                  )}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[320px]" title={event.location}>
                    {event.location}
                  </span>
                </div>
              )}

              {availableFiles.length > 1 && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{event.fileName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 self-end sm:self-start shrink-0">
            {onUpdateEvent && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingKey(isEditing ? null : key);
                }}
                disabled={editingDisabled || !event.fileName}
                className={cn(
                  buttonPreset,
                  'flex items-center gap-1 px-2.5 py-1 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                  isEditing && 'bg-secondary text-secondary-foreground'
                )}
                title={
                  !event.fileName
                    ? 'Noch nicht in einer CSV gespeichert'
                    : editingDisabled
                    ? 'Bearbeiten während des Abrufs gesperrt'
                    : isEditing
                    ? 'Bearbeiten schließen'
                    : 'Event inline bearbeiten'
                }
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isEditing ? 'Schließen' : 'Bearbeiten'}</span>
              </motion.button>
            )}

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring.snappy}
              onClick={() => toggleExpand(key)}
              className={cn(
                buttonPreset,
                'flex items-center gap-1.5 px-2.5 py-1 text-xs cursor-pointer'
              )}
              title={isExpanded ? 'Details verbergen' : 'Alle Werte anzeigen'}
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Weniger</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Details</span>
                </>
              )}
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring.snappy}
              onClick={(e) => handleStartDelete(event, e)}
              disabled={!event.fileName}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={event.fileName ? 'Aus CSV löschen' : 'Noch nicht in einer CSV gespeichert'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Löschen</span>
            </motion.button>
          </div>
        </div>

        {/* Inline Bearbeiten-Formular */}
        <AnimatePresence>
          {isEditing && onUpdateEvent && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring.soft}
              className="overflow-hidden"
            >
              <EventEditForm
                event={event}
                isInvalidAddress={quality.hasInvalidAddress}
                onSave={async (changes) => {
                  const res = await onUpdateEvent(event, changes);
                  if (res.success) {
                    setEditingKey(null);
                    if (res.notice) {
                      setFeedbackNotice(res.notice);
                    }
                  }
                  return res;
                }}
                onCancel={() => setEditingKey(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded Details Accordion */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring.soft}
              className="border-t border-border bg-muted/20 overflow-hidden"
            >
              <div className="p-4 space-y-4 text-xs">
                {/* Bild und Beschreibung */}
                <div className="flex flex-col md:flex-row gap-4 items-start">
                  {event.imageUrl ? (
                    <img
                      src={event.imageUrl}
                      alt={event.title}
                      className="w-full md:w-48 h-32 object-cover rounded-lg border border-border shrink-0 bg-background"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full md:w-48 h-24 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground text-[10px] shrink-0 bg-background/50">
                      <span>Kein Bild</span>
                    </div>
                  )}

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Beschreibung
                    </span>
                    <p className="text-muted-foreground leading-relaxed whitespace-pre-line text-[11px] line-clamp-6">
                      {event.description || 'Keine Beschreibung vorhanden.'}
                    </p>
                  </div>
                </div>

                {/* Links & Kontaktdaten */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Links & Details
                  </span>

                  <div className="flex flex-wrap gap-2">
                    {event.detailUrl && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        onClick={() => handleOpenLink(event.detailUrl)}
                        className={cn(
                          buttonPreset,
                          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] cursor-pointer'
                        )}
                      >
                        <ExternalLink className="w-3 h-3 text-tertiary" />
                        <span>Detail-Seite</span>
                      </motion.button>
                    )}

                    {event.ticketUrl && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        onClick={() => handleOpenLink(event.ticketUrl)}
                        className={cn(
                          buttonPreset,
                          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] cursor-pointer'
                        )}
                      >
                        <Ticket className="w-3 h-3 text-success" />
                        <span>Ticket-Shop</span>
                      </motion.button>
                    )}

                    {event.website && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        onClick={() => handleOpenLink(event.website)}
                        className={cn(
                          buttonPreset,
                          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] cursor-pointer'
                        )}
                      >
                        <Globe className="w-3 h-3 text-muted-foreground" />
                        <span>Veranstalter-Webseite</span>
                      </motion.button>
                    )}

                    {event.email && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        onClick={() => handleOpenLink(`mailto:${event.email}`)}
                        className={cn(
                          buttonPreset,
                          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] cursor-pointer'
                        )}
                      >
                        <Mail className="w-3 h-3 text-muted-foreground" />
                        <span>{event.email}</span>
                      </motion.button>
                    )}

                    {event.phone && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border border-border bg-background text-foreground">
                        <Phone className="w-3 h-3 text-muted-foreground" />
                        <span>{event.phone}</span>
                      </span>
                    )}

                    {event.socialMedia && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring.snappy}
                        onClick={() => handleOpenLink(event.socialMedia)}
                        className={cn(
                          buttonPreset,
                          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] cursor-pointer'
                        )}
                      >
                        <Share2 className="w-3 h-3 text-muted-foreground" />
                        <span>Social Media</span>
                      </motion.button>
                    )}
                  </div>
                </div>

                {/* Vollständige Spaltenübersicht aller extrahierten CSV-Werte */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Alle extrahierten CSV-Werte ({Object.keys(event.allFields).length} Spalten)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(event.allFields).map(([colName, colVal]) => {
                      const displayVal = (colVal || '').trim();
                      return (
                        <div
                          key={colName}
                          className="p-2 rounded-lg bg-background border border-border space-y-0.5 min-w-0"
                        >
                          <div className="text-[10px] font-semibold text-muted-foreground truncate" title={colName}>
                            {colName}
                          </div>
                          <div
                            className="text-[11px] text-foreground font-mono truncate"
                            title={displayVal || '(leer)'}
                          >
                            {displayVal ? displayVal : <span className="italic text-muted-foreground/60">(leer)</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Quelldatei */}
                <div className="pt-2 border-t border-border/60 text-[10px] text-muted-foreground font-mono flex items-center justify-between">
                  <span className="truncate max-w-md">Datei: {event.fileName}</span>
                  <span>Zeile: {event.rowIndex + 2}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border font-sans">
      <AnimatePresence>
        {feedbackNotice && (
          <motion.div
            role="status"
            data-testid="feedback-notice"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={spring.soft}
            className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-700 dark:text-amber-400 text-[11px] leading-relaxed overflow-hidden"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p className="flex-1">{feedbackNotice}</p>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              aria-label="Hinweis schließen"
              className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Filterleiste */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span>Inhalte der CSV-Datei</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-semibold">
              {events.length} {events.length === 1 ? 'Event' : 'Events'}
            </span>
            {invalidEvents.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-semibold">
                {invalidEvents.length} ungültig
              </span>
            )}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Prüfe die Daten, korrigiere Tippfehler oder Adressen direkt per &bdquo;Bearbeiten&ldquo; oder entferne Termine.
          </p>
        </div>

        {/* Suche & Filter */}
        <div className="flex items-center gap-2">
          {availableFiles.length > 1 && (
            <select
              value={selectedFileFilter}
              onChange={(e) => setSelectedFileFilter(e.target.value)}
              className={cn(
                inputPreset,
                'py-1.5 px-2.5 text-xs bg-background text-foreground shrink-0 cursor-pointer'
              )}
            >
              <option value="all">Alle Dateien ({events.length})</option>
              {availableFiles.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Suchen nach Titel, Ort..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                inputPreset,
                'py-1.5 pl-8 pr-3 text-xs w-full sm:w-56 bg-background text-foreground placeholder:text-muted-foreground'
              )}
            />
          </div>
        </div>
      </div>

      {/* Ergebnisliste */}
      {filteredEvents.length === 0 ? (
        <motion.div
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className={cn(cardPreset, 'p-8 text-center text-xs text-muted-foreground space-y-1')}
        >
          <p className="font-semibold text-foreground">Keine Events gefunden</p>
          <p>Kein Eintrag entspricht deinen aktuellen Filterkriterien.</p>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* Gesonderter Bereich für ungültige Events (unvollständige Adresse) */}
          {invalidEvents.length > 0 && (
            <motion.div
              layout
              className="space-y-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/5"
            >
              <div className="flex items-start gap-2.5">
                <AlertOctagon className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 flex-1">
                  <h3 className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                    <span>Ungültige Events ({invalidEvents.length})</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-300">
                      Keine auffindbare Adresse
                    </span>
                  </h3>
                  <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-relaxed">
                    Bei diesen Events lässt sich der Ort nicht eindeutig finden (nötig: PLZ oder Stadt plus Straße bzw. Name des Ortes, z. B. &bdquo;Frankenstraße 200, Nürnberg&ldquo;). Bitte ergänze die Adresse über &bdquo;Bearbeiten&ldquo;, damit die Events eine Kartenposition bekommen.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <AnimatePresence>
                  {invalidEvents.map((ev) => renderEventCard(ev, true))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Reguläre, gültige Events */}
          {validEvents.length > 0 && (
            <motion.div layout className="space-y-3">
              {invalidEvents.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <h3 className="text-xs font-bold text-foreground flex items-center gap-2">
                    <span>Gültige Events</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-semibold">
                      {validEvents.length}
                    </span>
                  </h3>
                </div>
              )}
              <AnimatePresence>
                {validEvents.map((ev) => renderEventCard(ev, false))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <EventDeleteModal
        isOpen={eventToDelete !== null}
        event={eventToDelete}
        isDeleting={isDeleting}
        error={deleteError}
        fileUnchanged={deleteLeftFileUntouched}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeleting) {
            setEventToDelete(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
};
