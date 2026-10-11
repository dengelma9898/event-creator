import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface FaviconProps {
  domain?: string;
  url?: string;
  name?: string;
  className?: string;
  size?: number;
}

export const Favicon: React.FC<FaviconProps> = ({
  domain,
  url,
  name,
  className,
  size = 20,
}) => {
  const [hasError, setHasError] = useState(false);

  // Domain auflösen
  let resolvedDomain = domain;
  if (!resolvedDomain && url) {
    try {
      resolvedDomain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // Ignorieren
    }
  }

  // Favicon-URL über Google Favicon API
  const faviconUrl = resolvedDomain
    ? `https://www.google.com/s2/favicons?domain=${resolvedDomain}&sz=64`
    : null;

  if (!faviconUrl || hasError) {
    return (
      <div
        className={cn(
          'rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground border border-border/80',
          className
        )}
        style={{ width: size, height: size }}
        title={name || resolvedDomain || 'Webseite'}
      >
        <Globe className="w-3/5 h-3/5 stroke-[1.5]" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md bg-card flex items-center justify-center shrink-0 overflow-hidden border border-border/60 shadow-2xs',
        className
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={faviconUrl}
        alt={name || resolvedDomain || 'Favicon'}
        className="w-full h-full object-contain p-0.5"
        loading="lazy"
        onError={() => setHasError(true)}
      />
    </div>
  );
};
