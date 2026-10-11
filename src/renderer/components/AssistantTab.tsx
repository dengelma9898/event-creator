import React, { useState, useEffect } from 'react';
import {
  Wand2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Calendar,
  Tag,
  Ticket,
  Loader2,
  AlertCircle,
  FileCheck,
  RefreshCw,
  Layers,
  Building2,
  ExternalLink,
  Copy,
  Check,
  Globe,
  User,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';

import type { AssistantAnalysisResult, SkillMetadata, PreviewEvent } from '../../shared/types.js';
import { cardPreset, inputPreset, buttonPreset, badgePreset } from '../lib/designTokens.js';
import { cn } from '../lib/utils.js';

interface AssistantTabProps {
  onSkillSavedAndSelect: (skillId: string) => void;
  onRefreshSkills: () => void;
}

export const AssistantTab: React.FC<AssistantTabProps> = ({
  onSkillSavedAndSelect,
  onRefreshSkills,
}) => {
  // Eingabezustand
  const [url, setUrl] = useState<string>('');

  // Human-in-the-Loop Refinement-Zustand
  const [editedName, setEditedName] = useState<string>('');
  const [refinementFeedback, setRefinementFeedback] = useState<string>('');
  const [refinementCount, setRefinementCount] = useState<number>(0);

  // Analyse-Zustände
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [detailsForDomiText, setDetailsForDomiText] = useState<string>('');
  const [copiedDetails, setCopiedDetails] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<AssistantAnalysisResult | null>(null);

  // Speichern-Zustände
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSkill, setSavedSkill] = useState<SkillMetadata | null>(null);

  // Status-Listener für Live-Meldungen während der Analyse
  useEffect(() => {
    const unsubscribe = window.electronAPI.assistant?.onStatusUpdate?.((msg: string) => {
      setStatusMessage(msg);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Validierung: Einziges Pflichtfeld ist eine gültige URL
  const isUrlValid = /^https?:\/\//i.test(url.trim());

  /**
   * Erste Analyse der neuen Webseite starten.
   */
  const handleStartAnalysis = async () => {
    if (!isUrlValid) return;

    setIsAnalyzing(true);
    setIsRefining(false);
    setStatusMessage('Öffne Webseite im Hintergrund...');
    setAnalysisError(null);
    setDetailsForDomiText('');
    setCopiedDetails(false);
    setAnalysisResult(null);
    setRefinementFeedback('');
    setRefinementCount(0);

    try {
      const result = await window.electronAPI.assistant.analyze({
        url: url.trim(),
      });

      if (result.success) {
        setAnalysisResult(result);
        setEditedName(result.name || '');
      } else {
        setAnalysisError(
          result.error ||
            'Die Internetseite konnte gerade nicht geöffnet oder analysiert werden. Frag Domi wie das geht.'
        );
        if (result.detailsForDomiText) {
          setDetailsForDomiText(result.detailsForDomiText);
        }
      }
    } catch (err: any) {
      setAnalysisError(
        'Hier hat etwas nicht geklappt. Frag Domi wie das geht.'
      );
      setDetailsForDomiText(
        `=== Details für Domi ===\nZeitpunkt: ${new Date().toISOString()}\nFunktion: Neue Webseite anlernen\nURL: ${url}\nFehler: ${err?.message || String(err)}\n========================`
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Human-in-the-Loop Refinement: Agenten mit konkretem Feedback anweisen.
   */
  const handleRefineAnalysis = async () => {
    if (!analysisResult || !refinementFeedback.trim()) return;

    setIsAnalyzing(true);
    setIsRefining(true);
    setStatusMessage('Passe Erkennung mit deinem Feedback an...');
    setAnalysisError(null);
    setDetailsForDomiText('');
    setCopiedDetails(false);

    try {
      const result = await window.electronAPI.assistant.analyze({
        url: url.trim(),
        name: editedName.trim() || analysisResult.name || undefined,
        feedback: refinementFeedback.trim(),
        previousSkillContent: analysisResult.generatedSkillContent,
      });

      if (result.success) {
        setAnalysisResult(result);
        if (result.name) {
          setEditedName(result.name);
        }
        setRefinementFeedback('');
        setRefinementCount((prev) => prev + 1);
      } else {
        setAnalysisError(
          result.error ||
            'Hier hat etwas nicht geklappt. Frag Domi wie das geht.'
        );
        if (result.detailsForDomiText) {
          setDetailsForDomiText(result.detailsForDomiText);
        }
      }
    } catch (err: any) {
      setAnalysisError('Hier hat etwas nicht geklappt. Frag Domi wie das geht.');
      setDetailsForDomiText(
        `=== Details für Domi ===\nZeitpunkt: ${new Date().toISOString()}\nFunktion: Anpassungslauf\nURL: ${url}\nFehler: ${err?.message || String(err)}\n========================`
      );
    } finally {
      setIsAnalyzing(false);
      setIsRefining(false);
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

  const handleOpenLink = async (targetUrl?: string) => {
    if (!targetUrl) return;
    try {
      await window.electronAPI.shell.openExternal(targetUrl);
    } catch (err) {
      console.error('Fehler beim Öffnen des Links:', err);
    }
  };

  /**
   * Bestätigen und dauerhaft als Skill speichern.
   */
  const handleSaveSkill = async () => {
    if (!analysisResult || !analysisResult.generatedSkillContent) return;

    setIsSaving(true);
    try {
      const finalName = (editedName.trim() || analysisResult.name || 'Webseite').trim();
      const finalSlug =
        analysisResult.slug ||
        finalName.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-');

      const saveRes = await window.electronAPI.assistant.saveSkill({
        slug: finalSlug,
        name: finalName,
        skillContent: analysisResult.generatedSkillContent,
      });

      if (saveRes.success && saveRes.skill) {
        setSavedSkill(saveRes.skill);
        onRefreshSkills();
      } else {
        setAnalysisError(saveRes.error || 'Fehler beim Speichern der neuen Webseite.');
      }
    } catch (err: any) {
      setAnalysisError(err?.message || 'Fehler beim Speichern.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setUrl('');
    setEditedName('');
    setRefinementFeedback('');
    setRefinementCount(0);
    setAnalysisResult(null);
    setAnalysisError(null);
    setSavedSkill(null);
  };

  // Gefundene Test-Events aufbereiten (1 oder 2)
  const eventsToDisplay: PreviewEvent[] =
    analysisResult?.previewEvents && analysisResult.previewEvents.length > 0
      ? analysisResult.previewEvents
      : analysisResult?.previewEvent
      ? [analysisResult.previewEvent]
      : [];

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in font-sans">
      {/* Kopfbereich */}
      <div>
        <h1 className="text-base sm:text-lg font-bold text-foreground tracking-tight">
          Neue Webseite anlernen
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Gib einfach die Webadresse ein. Der Agent analysiert die Seite autonom, ermittelt 1–2
          Test-Events und du kannst das Ergebnis vor dem Speichern prüfen oder verfeinern.
        </p>
      </div>

      {/* ================= 1. EINGABE-BEREICH (Wenn noch kein Ergebnis vorliegt) ================= */}
      {!analysisResult && !savedSkill && (
        <div className={cn(cardPreset, 'p-6 space-y-5 animate-fade-in')}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Internet-Adresse der Webseite (URL) <span className="text-destructive">*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.eventkalenderfranken.de/"
                disabled={isAnalyzing}
                className={cn(inputPreset, 'w-full py-2.5 px-3.5 text-xs font-mono')}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Vollständige URL mit <code className="text-foreground bg-muted px-1 py-0.5 rounded border border-border">https://</code> angeben. Der Agent ermittelt Name, Struktur und Test-Events vollständig autonom.
              </p>
            </div>
          </div>

          {/* Fehleranzeige */}
          {analysisError && !isAnalyzing && (
            <div className="p-4 rounded-xl border border-destructive/40 bg-card text-foreground text-xs space-y-3 animate-fade-in">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-destructive">Hinweis</p>
                  <p className="text-muted-foreground">{analysisError}</p>
                </div>
              </div>
              {detailsForDomiText && (
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Kopiere die Diagnose, um sie Domi weiterzuleiten:
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDetails}
                    className={cn(
                      buttonPreset,
                      'py-1.5 px-3 text-xs flex items-center gap-1.5 cursor-pointer bg-background hover:bg-muted/40 border border-border'
                    )}
                  >
                    {copiedDetails ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-success" />
                        <span className="text-success font-semibold">Kopiert!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Details für Domi kopieren</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Ladezustand */}
          {isAnalyzing && (
            <div className="p-8 text-center space-y-4 bg-muted/20 rounded-xl border border-border animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center mx-auto">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-bold text-foreground">
                  {statusMessage || 'Webseite wird im Hintergrund untersucht...'}
                </h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Die App öffnet die Seite, analysiert die Struktur und liest echte Veranstaltungen zur Vorschau aus. Das dauert in der Regel etwa 1 Minute.
                </p>
              </div>
            </div>
          )}

          {/* Start-Button */}
          {!isAnalyzing && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={!isUrlValid}
                onClick={handleStartAnalysis}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-2xs"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Webseite analysieren & Events ermitteln</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= 2. HUMAN-IN-THE-LOOP PRÜF- & REFINEMENT-BEREICH ================= */}
      {analysisResult && !savedSkill && (
        <div className="space-y-6 animate-fade-in">
          {/* Ladezustand während Refinement */}
          {isAnalyzing && (
            <div className="p-6 text-center space-y-3 bg-card rounded-xl border border-border animate-fade-in">
              <div className="w-7 h-7 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center mx-auto">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs sm:text-sm font-bold text-foreground">
                  {statusMessage || (isRefining ? 'Passe Erkennung mit deinem Feedback an...' : 'Aktualisiere Analyse...')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Die App öffnet die Webseite erneut und wendet deine Anpassungen an.
                </p>
              </div>
            </div>
          )}

          {/* Fehleranzeige bei Refinement */}
          {analysisError && !isAnalyzing && (
            <div className="p-4 rounded-xl border border-destructive/40 bg-card text-foreground text-xs space-y-3 animate-fade-in">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-destructive">Hinweis</p>
                  <p className="text-muted-foreground">{analysisError}</p>
                </div>
              </div>
              {detailsForDomiText && (
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Kopiere die Diagnose, um sie Domi weiterzuleiten:
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDetails}
                    className={cn(
                      buttonPreset,
                      'py-1.5 px-3 text-xs flex items-center gap-1.5 cursor-pointer bg-background hover:bg-muted/40 border border-border'
                    )}
                  >
                    {copiedDetails ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-success" />
                        <span className="text-success font-semibold">Kopiert!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Details für Domi kopieren</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Übersicht & Erkannte Eigenschaften */}
          <div className={cn(cardPreset, 'p-5 space-y-4')}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
              <div className="space-y-0.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">
                  Analyse-Ergebnis {refinementCount > 0 ? `(Iteration ${refinementCount + 1})` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  <span className="text-xs font-semibold text-foreground">
                    Webseite erfolgreich strukturiert
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Badge: Sammelseite vs. Spielstätte */}
                <span
                  className={cn(
                    badgePreset,
                    'text-[11px] px-2.5 py-0.5 flex items-center gap-1 font-semibold'
                  )}
                >
                  {analysisResult.sourceType === 'aggregator' ? (
                    <>
                      <Layers className="w-3 h-3 text-secondary" />
                      <span>Sammelseite (wechselnde Spielorte)</span>
                    </>
                  ) : (
                    <>
                      <Building2 className="w-3 h-3 text-secondary" />
                      <span>Feste Spielstätte / Veranstalter</span>
                    </>
                  )}
                </span>

                {/* Badge: Spaltenformat */}
                <span className={cn(badgePreset, 'text-[11px] px-2.5 py-0.5 flex items-center gap-1')}>
                  <Ticket className="w-3 h-3 text-secondary" />
                  <span>{analysisResult.columnCount === 17 ? '17 Spalten (inkl. Ticket-Links)' : '16 Spalten (Standard)'}</span>
                </span>
              </div>
            </div>

            {/* Name der Quelle zur Bestätigung/Korrektur */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1">
                  Name für das Menü (anpassbar)
                </label>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  disabled={isAnalyzing}
                  className={cn(inputPreset, 'w-full py-1.5 px-3 text-xs font-semibold')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Analysierte URL
                </label>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-mono text-muted-foreground break-all py-1.5 px-3 bg-muted/20 rounded-lg border border-border flex-1 select-all">
                    {url}
                  </div>
                  {url && (
                    <button
                      type="button"
                      onClick={() => handleOpenLink(url)}
                      title={`${url} im Standardbrowser öffnen`}
                      className={cn(
                        buttonPreset,
                        'py-1.5 px-3 text-xs flex items-center gap-1.5 shrink-0 bg-background hover:bg-muted border border-border cursor-pointer font-medium'
                      )}
                    >
                      <Globe className="w-3.5 h-3.5 text-secondary" />
                      <span>Webseite öffnen</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Erläuterungen vom Agenten & technische Details */}
            {(analysisResult.columnNote ||
              analysisResult.sourceTypeNote ||
              analysisResult.detailPagesNote ||
              analysisResult.agentNotes ||
              analysisResult.slug) && (
              <div className="text-xs text-muted-foreground bg-muted/20 p-3.5 rounded-lg border border-border space-y-2">
                {analysisResult.sourceTypeNote && (
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-foreground shrink-0 w-28">Typ:</span>
                    <span className="whitespace-pre-wrap leading-relaxed">{analysisResult.sourceTypeNote}</span>
                  </div>
                )}
                {analysisResult.columnNote && (
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-foreground shrink-0 w-28">Format:</span>
                    <span className="whitespace-pre-wrap leading-relaxed">{analysisResult.columnNote}</span>
                  </div>
                )}
                {analysisResult.detailPagesNote && (
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-foreground shrink-0 w-28">Navigation:</span>
                    <span className="whitespace-pre-wrap leading-relaxed">{analysisResult.detailPagesNote}</span>
                  </div>
                )}
                {analysisResult.agentNotes && (
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-foreground shrink-0 w-28">Agent-Hinweis:</span>
                    <span className="whitespace-pre-wrap leading-relaxed">{analysisResult.agentNotes}</span>
                  </div>
                )}
                {analysisResult.slug && (
                  <div className="flex items-start gap-2 pt-1.5 border-t border-border/40 text-[11px]">
                    <span className="font-semibold text-muted-foreground shrink-0 w-28">Dateikennung:</span>
                    <span className="font-mono text-foreground/80">{analysisResult.slug}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ================= 1–2 TEST-EVENTS ANZEIGEN ================= */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Gefundene Test-Events zur Bestätigung ({eventsToDisplay.length})
              </h2>
              <span className="text-[11px] text-muted-foreground">
                Prüfe bitte, ob Titel, Datum und Ort korrekt erkannt wurden – Links kannst du direkt im Browser aufrufen
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {eventsToDisplay.map((event, index) => (
                <div
                  key={index}
                  className={cn(
                    cardPreset,
                    'p-4 space-y-3.5 bg-muted/10 border-border hover:border-foreground/20 transition-all min-w-0 break-words flex flex-col justify-between'
                  )}
                >
                  <div className="space-y-3">
                    {/* Kopfzeile: Test-Event Nummer + Kategorie-Badge */}
                    <div className="flex items-center justify-between border-b border-border/50 pb-2 gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Test-Event {index + 1}
                      </span>
                      <span className={cn(badgePreset, 'text-[10px] px-2 py-0.5 flex items-center gap-1 shrink-0')}>
                        <Tag className="w-2.5 h-2.5 text-secondary" />
                        <span>{event.category || 'Kultur'}</span>
                      </span>
                    </div>

                    {/* Titel */}
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-foreground leading-snug">
                        {event.title}
                      </h3>
                    </div>

                    {/* Bild-Vorschau falls vorhanden */}
                    {event.imageUrl && (
                      <div className="relative rounded-lg overflow-hidden border border-border bg-muted/30 max-h-40">
                        <img
                          src={event.imageUrl}
                          alt={event.title}
                          className="w-full h-32 object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).parentElement?.classList.add('hidden');
                          }}
                        />
                      </div>
                    )}

                    {/* Kern-Daten */}
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {/* Datum & Uhrzeit */}
                      <div className="flex items-start gap-2">
                        <Calendar className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                        <span className="text-foreground font-medium">{event.dateTime || 'Datum nicht angegeben'}</span>
                      </div>

                      {/* Ort & Adresse */}
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                        <div className="space-y-0.5 min-w-0">
                          <span className="text-foreground">{event.location || 'Ort wird dynamisch ermittelt'}</span>
                          {event.address && event.address !== event.location && (
                            <p className="text-[11px] text-muted-foreground">{event.address}</p>
                          )}
                        </div>
                      </div>

                      {/* Veranstalter */}
                      {event.organizer && (
                        <div className="flex items-start gap-2">
                          <User className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                          <span className="text-muted-foreground">
                            <strong className="text-foreground/90 font-medium">Veranstalter:</strong> {event.organizer}
                          </span>
                        </div>
                      )}

                      {/* Preis / Eintritt */}
                      {event.price && (
                        <div className="flex items-start gap-2">
                          <Ticket className="w-3.5 h-3.5 text-tertiary shrink-0 mt-0.5" />
                          <span className="text-muted-foreground">
                            <strong className="text-foreground/90 font-medium">Eintritt / Preis:</strong> {event.price}
                          </span>
                        </div>
                      )}

                      {/* Beschreibung / Teaser */}
                      {event.description && (
                        <div className="flex items-start gap-2 pt-1 border-t border-border/40">
                          <FileText className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                          <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                            {event.description}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Klickbare Link-Aktionen zur direkten Prüfung */}
                  {(event.detailUrl || event.ticketUrl || event.imageUrl) && (
                    <div className="pt-2.5 border-t border-border/50 space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Webseiten zur Prüfung aufrufen:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {event.detailUrl && (
                          <button
                            type="button"
                            onClick={() => handleOpenLink(event.detailUrl)}
                            title={`${event.detailUrl} im Browser öffnen`}
                            className={cn(
                              buttonPreset,
                              'py-1.5 px-2.5 text-[11px] flex items-center gap-1.5 bg-background hover:bg-muted border border-border cursor-pointer font-medium'
                            )}
                          >
                            <Globe className="w-3 h-3 text-secondary" />
                            <span>Event-Seite</span>
                            <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                          </button>
                        )}

                        {event.ticketUrl && (
                          <button
                            type="button"
                            onClick={() => handleOpenLink(event.ticketUrl)}
                            title={`${event.ticketUrl} im Browser öffnen`}
                            className={cn(
                              buttonPreset,
                              'py-1.5 px-2.5 text-[11px] flex items-center gap-1.5 bg-background hover:bg-muted border border-border cursor-pointer font-medium text-tertiary'
                            )}
                          >
                            <Ticket className="w-3 h-3 text-tertiary" />
                            <span>Ticket-Link</span>
                            <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                          </button>
                        )}

                        {event.imageUrl && (
                          <button
                            type="button"
                            onClick={() => handleOpenLink(event.imageUrl)}
                            title={`${event.imageUrl} im Browser öffnen`}
                            className={cn(
                              buttonPreset,
                              'py-1.5 px-2.5 text-[11px] flex items-center gap-1.5 bg-background hover:bg-muted border border-border cursor-pointer font-medium text-muted-foreground'
                            )}
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>Bild-URL</span>
                            <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>

                      {/* Vollständige Links als lesbarer Text zum Nachvollziehen */}
                      <div className="space-y-0.5 text-[10px] font-mono text-muted-foreground/80 break-all select-all pt-1">
                        {event.detailUrl && (
                          <div className="flex items-start gap-1">
                            <span className="text-[9px] uppercase font-sans font-semibold text-muted-foreground shrink-0 w-12">Detail:</span>
                            <span>{event.detailUrl}</span>
                          </div>
                        )}
                        {event.ticketUrl && (
                          <div className="flex items-start gap-1">
                            <span className="text-[9px] uppercase font-sans font-semibold text-muted-foreground shrink-0 w-12">Ticket:</span>
                            <span>{event.ticketUrl}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ================= 2 HANDLUNGSWEGE: BESTÄTIGEN ODER VERFEINERN ================= */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* WEG 1: Bestätigen & Speichern */}
            <div className={cn(cardPreset, 'p-5 flex flex-col justify-between space-y-4 bg-muted/20 border-border')}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  <span>Ergebnis ist zufriedenstellend</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Wenn die Test-Events passen, speichere den neuen Scraper dauerhaft ab. Die Quelle steht dir danach direkt im Abruf-Menü zur Verfügung.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSaveSkill}
                disabled={isSaving || isAnalyzing}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary font-semibold text-xs disabled:opacity-50 transition-all cursor-pointer shadow-2xs"
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Speichere Quelle...' : '✓ Perfekt, Skill dauerhaft speichern'}</span>
              </button>
            </div>

            {/* WEG 2: Human-in-the-Loop Refinement */}
            <div className={cn(cardPreset, 'p-5 space-y-3')}>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-foreground">
                  <RefreshCw className="w-4 h-4 text-secondary shrink-0" />
                  <span>Noch nicht optimal? Verfeinern</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sage dem Agenten, was korrigiert werden soll (z. B. Ort, Datumsformat oder Kategorie):
                </p>
              </div>

              <div>
                <textarea
                  value={refinementFeedback}
                  onChange={(e) => setRefinementFeedback(e.target.value)}
                  disabled={isAnalyzing}
                  rows={2}
                  placeholder="z. B. 'Veranstaltungsort genauer aus Unterseite extrahieren' oder 'Kategorie auf Musik setzen'..."
                  className={cn(inputPreset, 'w-full py-2 px-3 text-xs resize-none')}
                />
              </div>

              <button
                type="button"
                onClick={handleRefineAnalysis}
                disabled={isAnalyzing || !refinementFeedback.trim()}
                className={cn(
                  buttonPreset,
                  'w-full flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
                )}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isAnalyzing && 'animate-spin')} />
                <span>Mit Feedback verfeinern (Neuer Run)</span>
              </button>
            </div>
          </div>

          {/* Abbrechen / Neu starten */}
          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={isAnalyzing || isSaving}
              className={cn(buttonPreset, 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer')}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Verwerfen & andere Seite anlernen</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= 3. ERFOLGS-SCREEN ================= */}
      {savedSkill && (
        <div className="p-8 rounded-md border border-success/40 bg-card text-center space-y-5 animate-fade-in">
          <div className="w-12 h-12 rounded-full border border-success/40 bg-success/10 text-success flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-foreground">
              Webseite erfolgreich angelernt!
            </h2>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              Die Quelle <strong>{savedSkill.name}</strong> wurde dauerhaft als Scraper gespeichert und steht ab sofort für Termine zur Verfügung.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onSkillSavedAndSelect(savedSkill.id)}
              className="flex items-center gap-2 px-5 py-2.5 bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary text-xs font-semibold rounded-xl transition-colors cursor-pointer shadow-2xs"
            >
              <span>Jetzt Termine für diese Seite abrufen</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleReset}
              className={cn(buttonPreset, 'px-4 py-2.5 text-xs font-medium cursor-pointer')}
            >
              Weitere Webseite anlernen
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
