import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const base =
    'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[11px] font-medium w-fit whitespace-nowrap shrink-0 gap-1 transition-colors';

  const variants = {
    default: 'border-border bg-secondary text-secondary-foreground',
    secondary: 'border-transparent bg-muted text-muted-foreground',
    destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
    outline: 'border-border bg-background text-foreground',
    success: 'border-success/30 bg-success/15 text-success',
    warning: 'border-warning/30 bg-warning/15 text-warning-foreground',
  };

  return (
    <span
      data-slot="badge"
      className={cn(base, variants[variant], className)}
      {...props}
    />
  );
}
