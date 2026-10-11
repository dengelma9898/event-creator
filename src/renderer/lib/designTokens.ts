import { cn } from './utils.js';

/**
 * Design-Token-Utilities für konsistentes Styling im nativen Mac-Look.
 * Weichere Kontraste, angenehme Borders (border-border) und ruhige Flächen.
 */

/** Basis-Klassen für Cards mit weicher Border und Mac-Anmutung */
export const cardPreset = cn(
  'bg-card',
  'border',
  'border-border',
  'rounded-xl',
  'transition-all duration-200'
);

/** Card-Klassen mit Hover-Effekt */
export const cardPresetHover = cn(cardPreset, 'hover:border-foreground/25', 'cursor-pointer');

/** Input-Feld-Klassen */
export const inputPreset = cn(
  'bg-background',
  'border',
  'border-border',
  'text-foreground',
  'placeholder:text-muted-foreground',
  'focus:border-foreground/40',
  'focus:outline-none',
  'rounded-lg',
  'transition-all duration-200'
);

/** Button-Klassen (Outline-Default) */
export const buttonPreset = cn(
  'bg-background',
  'border',
  'border-border',
  'text-foreground',
  'hover:bg-muted/70',
  'hover:border-foreground/30',
  'rounded-lg',
  'transition-all duration-200'
);

/** Badge/Label-Klassen */
export const badgePreset = cn(
  'bg-muted/50',
  'border',
  'border-border',
  'text-foreground',
  'rounded-md'
);

/** Listen-Header und Filter-Sections */
export const listSectionPreset = cn(cardPreset, 'p-4 mb-6');
