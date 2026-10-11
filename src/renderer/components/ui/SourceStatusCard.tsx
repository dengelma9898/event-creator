import React from 'react';
import { ExternalLink, Clock, CalendarCheck2, Sparkles, Loader2 } from 'lucide-react';
import type { SkillMetadata, SourceStatusInfo } from '../../../shared/types.js';
import { Favicon } from './Favicon.js';

interface SourceStatusCardProps {
  skill: SkillMetadata;
  status: SourceStatusInfo | null;
  isLoading?: boolean;
}

export const SourceStatusCard: React.FC<SourceStatusCardProps> = ({
  skill,
  status,
  isLoading = false,
}) => {
  const targetUrl = status?.targetUrl || skill.targetUrl;
  const displayName = skill.name.replace(/\s*\([^)]*\)$/, '');

  const handleOpenWebsite = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (targetUrl) {
      await window.electronAPI.shell.openExternal(targetUrl);
    }
  };

  const statusLevel = status?.statusLevel || 'never';

  // Ampel-Styling basierend auf Status-Level
  const renderStatusBadge = () => {
    switch (statusLevel) {
      case 'fresh':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border border-success/30 bg-success/15 text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            {status?.statusText || 'Taufrisch'}
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-border bg-muted/60 text-foreground/90">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {status?.statusText || 'Bereit für neuen Abruf'}
          </span>
        );
      case 'recommended':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border border-warning/30 bg-warning/15 text-warning-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {status?.statusText || 'Neuer Abruf empfohlen'}
          </span>
        );
      case 'never':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-border bg-muted/40 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
            {status?.statusText || 'Bereit für ersten Abruf'}
          </span>
        );
    }
  };

  return (
    <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-3 transition-all animate-fade-in text-xs">
      {/* Header mit Quelle, Domain und Direkt-Vorschau-Button */}
      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-border/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <Favicon
            domain={skill.domain}
            url={targetUrl}
            name={skill.name}
            size={22}
          />
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-semibold text-foreground truncate">{displayName}</span>
            {skill.domain && (
              <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline truncate">
                {skill.domain}
              </span>
            )}
          </div>
        </div>

        {targetUrl && (
          <button
            type="button"
            onClick={handleOpenWebsite}
            title={`${targetUrl} im Browser öffnen`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-foreground bg-background hover:bg-muted border border-border/80 transition-colors shrink-0 cursor-pointer shadow-2xs"
          >
            <span>Webseite</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Inhalt: Details oder Ladezustand */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-1 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary" />
          <span>Status der Quelle wird ermittelt...</span>
        </div>
      ) : (
        <div className="space-y-2 text-foreground/90">
          {/* Letzter Abruf */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Letzter Abruf:</span>
            </div>
            <span className="font-medium text-foreground text-right">
              {status?.lastRunFormatted || 'Noch nie abgerufen'}
            </span>
          </div>

          {/* Aktueller Datenbestand */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarCheck2 className="w-3.5 h-3.5 shrink-0" />
              <span>Aktueller Datenbestand:</span>
            </div>
            <div className="flex items-center gap-1 font-medium text-foreground text-right">
              <span className="font-semibold font-mono tabular-nums">
                {status?.futureEventsCount ?? 0}
              </span>
              <span>zukünftige Termine gespeichert</span>
              {status?.fileCount && status.fileCount > 1 ? (
                <span className="text-[11px] text-muted-foreground">
                  ({status.fileCount} Dateien)
                </span>
              ) : null}
            </div>
          </div>

          {/* Empfehlung / Status */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-tertiary shrink-0" />
              <span>Empfehlung:</span>
            </div>
            <div>{renderStatusBadge()}</div>
          </div>
        </div>
      )}
    </div>
  );
};
