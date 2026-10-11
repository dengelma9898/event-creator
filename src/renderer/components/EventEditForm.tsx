import React, { useState } from 'react';
import { Save, X, Loader2, AlertCircle, MapPin, Tag, Clock, Type } from 'lucide-react';
import type { CsvEventRecord, EventChanges, EditOutcome } from '../../shared/types.js';
import { APP_CATEGORIES, isValidTime, isValidAddress } from '../../shared/event-quality.js';
import { inputPreset, buttonPreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';

interface EventEditFormProps {
  event: CsvEventRecord;
  isInvalidAddress: boolean;
  onSave: (changes: EventChanges) => Promise<EditOutcome>;
  onCancel: () => void;
}

export const EventEditForm: React.FC<EventEditFormProps> = ({
  event,
  isInvalidAddress,
  onSave,
  onCancel,
}) => {
  const [title, setTitle] = useState(event.title || '');
  const [category, setCategory] = useState(event.category || '');
  const [startTime, setStartTime] = useState(event.startTime || '');
  const [location, setLocation] = useState(event.location || '');
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setValidationError('Der Titel darf nicht leer sein.');
      return;
    }

    if (title.includes('\n') || title.includes('\r')) {
      setValidationError('Der Titel darf keine Zeilenumbrüche enthalten.');
      return;
    }

    const trimmedTime = startTime.trim();
    if (trimmedTime && !isValidTime(trimmedTime)) {
      setValidationError('Ungültige Startzeit. Bitte das Format HH:mm verwenden (z. B. 20:00).');
      return;
    }

    const trimmedLocation = location.trim();
    // Wenn die Adresse zuvor ungültig war oder geändert wurde, muss sie vollständig sein
    const locationChanged = trimmedLocation !== (event.location || '').trim();
    if (isInvalidAddress || locationChanged) {
      if (!isValidAddress(trimmedLocation)) {
        setValidationError(
          'Adresse unvollständig. Nötig sind PLZ oder Stadt plus Straße bzw. Name des Ortes (z. B. "Frankenstraße 200, Nürnberg" oder "Z-Bau, 90461 Nürnberg").'
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const changes: EventChanges = {
        title: trimmedTitle,
        category: category.trim(),
        startTime: trimmedTime,
      };
      if (locationChanged || isInvalidAddress) {
        changes.location = trimmedLocation;
      }

      const res = await onSave(changes);
      if (res.success) {
        onCancel();
      } else {
        setValidationError(res.error || 'Fehler beim Speichern der Änderungen.');
      }
    } catch (err: any) {
      setValidationError(err?.message || 'Unerwarteter Fehler beim Speichern.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-muted/30 border-t border-border space-y-4 text-xs animate-fade-in font-sans">
      <div className="flex items-center justify-between pb-2 border-b border-border/80">
        <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
          <span>Termin bearbeiten</span>
          <span className="text-[10px] text-muted-foreground font-normal">(wird direkt in der CSV gespeichert)</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors cursor-pointer"
          title="Bearbeiten abbrechen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {validationError && (
        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-[11px] leading-relaxed animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p className="flex-1">{validationError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Titel */}
        <div className="space-y-1 md:col-span-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Type className="w-3 h-3 text-foreground/70" />
            <span>Titel (Pflichtfeld)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSaving}
            placeholder="Veranstaltungstitel eingeben..."
            className={cn(inputPreset, 'w-full py-1.5 px-3 text-xs')}
          />
        </div>

        {/* Kategorie */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Tag className="w-3 h-3 text-foreground/70" />
            <span>App-Kategorie</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isSaving}
            className={cn(inputPreset, 'w-full py-1.5 px-2.5 text-xs bg-background cursor-pointer')}
          >
            <option value="">(Keine Kategorie zugeordnet)</option>
            {APP_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Startzeit */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3 text-foreground/70" />
            <span>Startzeit (HH:mm)</span>
          </label>
          <input
            type="text"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isSaving}
            placeholder="z. B. 20:00"
            className={cn(inputPreset, 'w-full py-1.5 px-3 text-xs font-mono')}
          />
        </div>

        {/* Veranstaltungsort / Adresse */}
        <div className="space-y-1 md:col-span-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3 text-foreground/70" />
            <span>Veranstaltungsort & Adresse</span>
            {isInvalidAddress && (
              <span className="text-amber-700 dark:text-amber-400 font-semibold normal-case text-[10px] ml-1">
                (PLZ oder Stadt plus Straße bzw. Ortsname erforderlich)
              </span>
            )}
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={isSaving}
            placeholder='z. B. "Z-Bau, Frankenstraße 200, 90461 Nürnberg"'
            className={cn(
              inputPreset,
              'w-full py-1.5 px-3 text-xs',
              isInvalidAddress && 'border-amber-500/50 focus:border-amber-500'
            )}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className={cn(buttonPreset, 'px-3 py-1.5 text-xs font-medium cursor-pointer')}
        >
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-secondary-foreground bg-secondary hover:bg-secondary/90 disabled:opacity-50 rounded-lg border border-secondary transition-all cursor-pointer shadow-2xs"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Wird gespeichert...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Speichern & prüfen</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
