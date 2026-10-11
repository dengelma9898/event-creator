import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { SkillMetadata, SourceStatusInfo } from '../../../shared/types.js';
import { Favicon } from './Favicon.js';
import { cn } from '../../lib/utils.js';

interface SourceSelectProps {
  skills: SkillMetadata[];
  selectedSkillId: string;
  onSelect: (skillId: string) => void;
  statuses?: Record<string, SourceStatusInfo>;
  disabled?: boolean;
}

export const SourceSelect: React.FC<SourceSelectProps> = ({
  skills,
  selectedSkillId,
  onSelect,
  statuses,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);
  const selectedStatus = selectedSkill ? statuses?.[selectedSkill.id] : undefined;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const currentIndex = skills.findIndex((s) => s.id === selectedSkillId);
      const nextIndex =
        e.key === 'ArrowDown'
          ? (currentIndex + 1) % skills.length
          : (currentIndex - 1 + skills.length) % skills.length;
      if (skills[nextIndex]) {
        onSelect(skills[nextIndex].id);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
  };

  const getStatusSummary = (status?: SourceStatusInfo) => {
    if (!status) return '';
    const level = status.statusLevel;
    if (level === 'never') {
      return 'Noch nie abgerufen';
    }
    if (level === 'fresh') {
      return 'Heute aktualisiert';
    }
    const shortRelative = status.lastRunFormatted.replace(/\s*\(.*\)$/, '').trim();
    if (level === 'recommended') {
      if (status.futureEventsCount === 0) {
        return 'Keine Termine – Abruf empfohlen';
      }
      return `${shortRelative} – Abruf empfohlen`;
    }
    return shortRelative || status.statusText;
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          'w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border bg-card text-foreground transition-all cursor-pointer',
          'border-border hover:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-border',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {selectedSkill ? (
            <>
              <Favicon
                domain={selectedSkill.domain}
                url={selectedSkill.targetUrl}
                name={selectedSkill.name}
                size={22}
              />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-foreground truncate">
                  {selectedSkill.name.replace(/\s*\([^)]*\)$/, '')}
                </span>
                {selectedStatus && (
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      selectedStatus.statusLevel === 'fresh' && 'bg-emerald-500 ring-2 ring-emerald-500/20',
                      selectedStatus.statusLevel === 'ready' && 'bg-emerald-500',
                      selectedStatus.statusLevel === 'recommended' && 'bg-amber-500',
                      selectedStatus.statusLevel === 'never' && 'bg-muted-foreground/40'
                    )}
                    title={`Status: ${selectedStatus.statusText}`}
                  />
                )}
                {selectedSkill.domain && (
                  <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                    {selectedSkill.domain}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Bitte eine Webseite wählen...</span>
          )}
        </div>

        <ChevronDown
          className={cn(
            'w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-150',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-border bg-card/98 backdrop-blur-lg shadow-lg p-1.5 space-y-0.5 animate-fade-in focus:outline-none"
        >
          {skills.map((skill) => {
            const isSelected = skill.id === selectedSkillId;
            const displayName = skill.name.replace(/\s*\([^)]*\)$/, '');
            const status = statuses?.[skill.id];
            const statusLevel = status?.statusLevel || 'never';
            const statusSummary = getStatusSummary(status);

            return (
              <li
                key={skill.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(skill.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors select-none',
                  isSelected
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-foreground/90 hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Favicon
                    domain={skill.domain}
                    url={skill.targetUrl}
                    name={skill.name}
                    size={20}
                  />
                  {/* Ampel-Punkt */}
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      statusLevel === 'fresh' && 'bg-emerald-500 shadow-2xs',
                      statusLevel === 'ready' && 'bg-emerald-500',
                      statusLevel === 'recommended' && 'bg-amber-500',
                      statusLevel === 'never' && 'bg-muted-foreground/40'
                    )}
                    title={status?.statusText || 'Status'}
                  />
                  <span className="truncate">{displayName}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {statusSummary && (
                    <span
                      className={cn(
                        'text-[10px] hidden md:inline truncate max-w-[200px]',
                        statusLevel === 'recommended'
                          ? 'text-amber-500/90 font-medium'
                          : 'text-muted-foreground'
                      )}
                    >
                      {statusSummary}
                    </span>
                  )}
                  {skill.domain && (
                    <span className="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 rounded bg-muted/60 border border-border/50">
                      {skill.domain}
                    </span>
                  )}
                  {isSelected && <Check className="w-3.5 h-3.5 text-tertiary" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
