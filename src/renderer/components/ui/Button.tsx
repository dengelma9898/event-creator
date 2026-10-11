import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
}: {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
} = {}) => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]';

  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 border border-border shadow-2xs',
    destructive:
      'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30 border border-transparent shadow-2xs',
    outline:
      'border border-border bg-background hover:bg-muted hover:text-foreground text-foreground shadow-2xs',
    secondary:
      'bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-secondary shadow-2xs',
    ghost:
      'hover:bg-accent hover:text-accent-foreground text-foreground border border-transparent',
    link:
      'text-foreground underline-offset-4 hover:underline border border-transparent',
  };

  const sizes = {
    default: 'h-9 px-4 py-2',
    sm: 'h-8 rounded-md gap-1.5 px-3 text-[11px]',
    lg: 'h-10 rounded-md px-6 text-sm',
    icon: 'size-8 flex items-center justify-center',
  };

  return cn(base, variants[variant], sizes[size], className);
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
